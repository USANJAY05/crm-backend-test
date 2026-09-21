// src/ai/postCallAgents/sentimentAgent.js
// ============================================================
// Post-call sentiment classification — Positive/Neutral/Negative/Unknown.
//
// "Unknown" covers the "not enough of a real conversation to judge" case
// (the caller was busy and asked for a callback) — using the schema's
// existing Unknown value rather than a literal null, since sentiment is a
// typed enum ('Positive' | 'Neutral' | 'Negative' | 'Unknown') across the
// DB column, CallLog/Lead types, Reports' sentiment breakdown, and the
// sentiment chip components — introducing null would need every one of
// those to add null-handling for no real benefit over the sentinel value
// they already all support.
// ============================================================

const { z } = require("zod");
const { getEffectivePrompt } = require("../systemAgents");
const { getModelForOrg, log, formatWorkflowAnswers } = require("./shared");

const SentimentSchema = z.object({
  sentiment: z.enum(["Positive", "Neutral", "Negative", "Unknown"]),
});

async function analyzeSentiment(transcript, orgId = null, workflowAnswers = []) {
  if (!transcript?.trim()) return { sentiment: "Unknown", inputTokens: 0, outputTokens: 0 };
  try {
    const template = await getEffectivePrompt(orgId, "sentiment-analyzer");
    const prompt = template
      .replace("{workflowAnswers}", formatWorkflowAnswers(workflowAnswers))
      .replace("{transcript}", transcript);
    // includeRaw: true so the underlying AIMessage (and its token usage)
    // is still available — the caller (vobizProxy.js/geminiProxy.js) folds
    // inputTokens/outputTokens below into the "gemini-postcall" cost-
    // provider usage session alongside the other post-call agents (see
    // callFinalizer.js's finalizeCallRecord). usage_metadata is
    // LangChain's normalized token count across providers, already
    // inclusive of Gemini's "thinking" tokens.
    const { raw, parsed } = await getModelForOrg(orgId)
      .withStructuredOutput(SentimentSchema, { includeRaw: true, name: "sentiment" })
      .invoke(prompt);
    const usage = raw?.usage_metadata || {};
    return {
      sentiment: parsed.sentiment,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
    };
  } catch (err) {
    log.error("❌ [postCallAgents:sentiment] error:", err.message);
    return { sentiment: "Unknown", inputTokens: 0, outputTokens: 0 };
  }
}

module.exports = { analyzeSentiment };
