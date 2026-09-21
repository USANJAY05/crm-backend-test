// src/ai/postCallAgents/shared.js
// ============================================================
// Shared plumbing for every post-call AI agent in this folder — a single
// LangChain chat model plus its Zod-schema structured-output helper.
//
// Uses LangChain's `.withStructuredOutput(zodSchema)` instead of the old
// hand-rolled "call Gemini -> JSON.parse -> schema.parse -> retry once on
// failure" loop — LangChain drives the model's native structured-output/
// function-calling mode itself (so the model is constrained to the schema
// shape, not just asked nicely in the prompt) and retries/repairs
// malformed output internally, giving the same Pydantic-style "define a
// schema, get a validated typed object back" guarantee Zod already gave
// us, just enforced at the model layer instead of after the fact.
//
// Same dual auth modes as googleAiClient.js (Vertex AI vs. Google AI
// Studio API key) — genai.isVertex there is the one source of truth for
// which mode this deployment is in, so this mirrors it exactly rather
// than re-deriving the choice from env vars a second time.
// ============================================================

const { ChatVertexAI } = require("@langchain/google-vertexai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const genai = require("../googleAiClient");
const { getLogger } = require("../../observability/logger");
const log = getLogger("ai.postCallAgents");

const MODEL = "gemini-2.5-flash-lite";

// Both LangChain client classes throw in their CONSTRUCTOR when no
// credentials are configured (unlike @google/genai's client, which only
// warns and defers the failure to the first actual call) — constructing
// this eagerly at module load would crash the whole process on require
// in any environment without Gemini set up (a bare local checkout, CI),
// even one that never ends up placing a real call. Built lazily instead,
// and only once, the first time an agent actually needs it.
const _models = new Map();
function getModel(orgId = null) {
  const cacheKey = genai.isVertex ? String(orgId || "shared") : "studio";
  if (_models.has(cacheKey)) return _models.get(cacheKey);

  if (genai.isVertex) {
    // getClientForOrg resolves the dedicated project created for this org.
    // The model is created lazily inside generateStructured because resolving
    // the org project is asynchronous.
    return null;
  }

  const model = new ChatGoogleGenerativeAI({
    model: MODEL,
    apiKey: process.env.GEMINI_API_KEY,
  });
  _models.set(cacheKey, model);
  return model;
}

async function getModelForOrg(orgId = null) {
  if (!genai.isVertex) return getModel(null);
  const client = await genai.getClientForOrg(orgId);
  const projectKey = client.projectId;
  const credentialKey = client.runtimeCredentialFingerprint || "unknown";
  const modelKey = `${projectKey}:${credentialKey}`;
  if (_models.has(modelKey)) return _models.get(modelKey);
  if (!client.runtimeCredentials) {
    throw new Error(`Organization ${orgId} has no organization-specific Google Cloud runtime credentials.`);
  }
  const model = new ChatVertexAI({
    model: MODEL,
    location: client.location || "us-central1",
    authOptions: {
      projectId: projectKey,
      credentials: client.runtimeCredentials,
    },
  });
  _models.set(modelKey, model);
  return model;
}

// Invokes the model constrained to `schema` and returns the validated,
// typed result directly — no manual JSON.parse, no manual retry loop.
// `fallback` (a value, or a function receiving the caught error) covers
// the same "never throw into the caller" contract the old
// generateValidated() had, for a genuinely failed call (bad credentials,
// network error, the model refusing entirely) rather than malformed
// output, which LangChain's structured-output mode already guards against
// at the model level.
// `onUsage`, when given, is called once with { inputTokens, outputTokens }
// from the underlying AIMessage's usage_metadata (LangChain's normalized
// token count, same field sentimentAgent.js already reads) — lets a
// caller meter/track cost for this specific generation without changing
// this function's return value, so every existing call site keeps
// working unchanged. Not called on a genuinely failed request (network
// error, bad credentials) since there's no usage to report; a fallback
// value being returned isn't itself a cost.
async function generateStructured({ prompt, schema, fallback, label, onUsage, orgId = null }) {
  try {
    const { raw, parsed } = await getModelForOrg(orgId)
      .withStructuredOutput(schema, { includeRaw: true, name: label })
      .invoke(prompt);
    if (onUsage) {
      const usage = raw?.usage_metadata || {};
      onUsage({ inputTokens: usage.input_tokens || 0, outputTokens: usage.output_tokens || 0 });
    }
    return parsed;
  } catch (err) {
    log.error(`❌ [postCallAgents:${label}] structured generation failed: ${err.message}`);
    return typeof fallback === "function" ? fallback(err) : fallback;
  }
}

// Renders the workflow answers already captured during a call (see
// db.getResponsesByCallId — the same live-tool-call data callFinalizer.js
// itself prefers) into prompt text — shared by the sentiment and summary
// agents so both judge/describe a call using what was actually learned,
// not the transcript alone.
function formatWorkflowAnswers(workflowAnswers) {
  const rows = (workflowAnswers || []).filter((r) => r?.question);
  if (!rows.length) return "(No workflow questions were tracked for this call.)";
  return rows.map((r) => `- ${r.label || r.question}: ${r.answer?.trim() || "(no answer given)"}`).join("\n");
}

module.exports = { MODEL, getModel, getModelForOrg, log, generateStructured, formatWorkflowAnswers };
