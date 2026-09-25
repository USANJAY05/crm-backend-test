// src/ai/systemAgents.js
// ============================================================
// Catalog of the built-in AI "agents" that already run as part of every
// call, as opposed to the user-created calling agents (org_agents table,
// GET/POST/PUT /api/agents) that get a name, voice, and phone number.
// These have no phone number — they never place or answer a call
// themselves — they run in the post-call pipeline (see
// src/ai/postCallAgents.js, called from callFinalizer.js and each
// provider's processPostCallData) against the transcript a live call
// already produced.
//
// Exposed via GET /api/agents/system for visibility in Agent Studio, so
// "why did this call get marked Negative sentiment" has a system prompt
// to actually go look at. PUT /api/agents/system/:id lets an org
// customize that prompt — the override is stored per-org (organizations
// .settings.systemAgentPrompts, the same free-form JSONB column
// /api/settings/org already uses for any org-level preference — see
// db.updateOrg/orgRowToApi in repository.js) rather than editing
// SYSTEM_AGENTS below, which stays the shared default/fallback for every
// org that hasn't customized a given agent, and what a blank save resets
// back to.
//
// {transcript} (and {questions} for the answer extractor) are NOT
// decorative — postCallAgents.js does a literal string substitution on
// them before calling the model, so a prompt that drops the placeholder
// silently runs with no transcript at all. validatePromptTemplate below
// rejects a save that removes one, rather than letting that happen
// silently.
// ============================================================

const REQUIRED_PLACEHOLDERS = {
  "sentiment-analyzer": ["{transcript}", "{workflowAnswers}"],
  "call-summarizer": ["{transcript}", "{workflowAnswers}", "{callerNow}"],
  "workflow-answer-extractor": ["{transcript}", "{questions}"],
  "follow-up-safety-net": ["{transcript}", "{callerNow}", "{sentiment}", "{summary}"],
};

const { getSetting } = require("../platform/settings");

const SYSTEM_AGENTS = [
  {
    id: "sentiment-analyzer",
    name: "Sentiment Analyzer",
    description: "Classifies every finished call as Positive, Neutral, Negative, or null when sentiment should not be inferred (for example a busy/callback-only call).",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are the post-call Sentiment Agent. Classify the caller's sentiment from the transcript and workflow answers only. Return exactly one of: Positive, Neutral, Negative, or null.\n\nPositive = the caller engaged/cooperated, answered questions, showed interest, agreed to next steps, or asked useful follow-up questions.\n\nNegative = the caller explicitly refused, said they are not interested, asked not to be contacted, or clearly rejected the offering. Do not label a merely short, blunt, or uncertain response as Negative.\n\nnull = the caller was busy, unavailable, could not continue, requested a callback, or there is not enough genuine conversation to classify sentiment. Busy/callback is NOT Negative or Neutral.\n\nNeutral = a genuine conversation occurred but there is no clear positive or negative signal.\n\nWorkflow answers captured during this call:\n{workflowAnswers}\n\nTranscript:\n{transcript}\n\nReply with ONLY a JSON object: {\"sentiment\":\"Positive\"} or {\"sentiment\":\"Neutral\"} or {\"sentiment\":\"Negative\"} or {\"sentiment\":null}.",
    tools: [],
    runsOn: "After every call ends, before the call_logs row is written (src/ai/postCallAgents/sentimentAgent.js:analyzeSentiment)",
  },
  {
    id: "call-summarizer",
    name: "Call Summarizer",
    description: "Writes the 2-3 sentence summary, key points, and outcome classification shown on every call log.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are the post-call Summary Agent. Summarize a completed AI voice call for someone who was not on it. Use BOTH the transcript and workflow answers. Never invent facts. You are descriptive only: DO NOT decide whether to schedule a callback and DO NOT create or classify an enquiry.\n\nReply with ONLY a valid JSON object:\n{\n  \"summary\": \"2-3 sentence plain-English summary of what was discussed and the concrete outcome\",\n  \"keyPoints\": [\"one short bullet per concrete useful fact or decision\"],\n  \"outcome\": \"Interested | Not Interested | Callback Requested | No Answer | Wrong Number | Incomplete\",\n  \"callerName\": \"name actually stated by the caller, or null\"\n}\n\nA callback may be mentioned in the summary/outcome as a description of what happened, but callback scheduling is owned exclusively by the Scheduling & Enquiry Agent. An enquiry is created only when the caller asked a meaningful question/request that the agent genuinely could not answer or resolve; this agent must not make that action decision.\n\nWorkflow answers captured during this call:\n{workflowAnswers}\n\nCaller local date/time:\n{callerNow}\n\nTranscript:\n{transcript}",
    tools: [],
    runsOn: "After every call ends (src/ai/postCallAgents/summaryAgent.js:generateCallSummary)",
  },
  {
    id: "workflow-answer-extractor",
    name: "Workflow Answer Extractor",
    description: "Pulls the caller's answer to each of a dialer task's questionnaire questions out of the finished transcript — the fallback when the live call's own tool-calling didn't save an answer for every question.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are a data extractor. Given this call transcript and a list of questions, extract the caller's answer to each question.\n\nCRITICAL — verify against the transcript itself, not your impression of the conversation: only fill in an answer if the caller actually, literally said something that answers that specific question, somewhere in the transcript text below. Do not infer, guess, paraphrase from a vague or partial reply into a confident-sounding answer, or fill in what a typical caller would probably have said. If you are not certain the transcript actually contains a real answer to a question, treat it as unanswered — an empty string is always safer than a wrong or invented one, since this becomes a permanent record.\n\nReply with ONLY a valid JSON array: [{\"question\": \"...\", \"answer\": \"...\"}, ...]\nIf the caller did not answer a question, use an empty string for answer.\nQuestions:\n{questions}\nTranscript:\n{transcript}",
    tools: [],
    runsOn: "After a task-assigned call ends, only if the live call didn't already save every answer (src/ai/postCallAgents.js:extractWorkflowAnswers)",
  },
  {
    id: "follow-up-safety-net",
    name: "Scheduling & Enquiry Agent",
    description: "Owns post-call callback and enquiry decisions. A caller who actually speaks is never a No Answer call; a callback is scheduled only when the caller requests one and gives a usable time.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are the Scheduling & Enquiry Agent. You are the ONLY post-call agent allowed to decide callback and enquiry actions. The transcript is authoritative. Never confuse a retry for an unanswered call with a conversational callback.\n\nCaller local date/time: {callerNow}\nSentiment: {sentiment}\nSummary: {summary}\nTranscript:\n{transcript}\n\nReturn ONLY this JSON:\n{\n  \"callbackRequested\": true|false,\n  \"callbackTimeMentioned\": true|false,\n  \"callbackRelativeMinutes\": number|null,\n  \"callbackLocalDateTime\": \"YYYY-MM-DDTHH:mm:ss\"|null,\n  \"enquiryRequested\": true|false,\n  \"enquirySummary\": \"the specific unresolved question/request\"|null,\n  \"callerName\": \"name or null\"\n}\n\nANSWERED VS NO ANSWER — HARD RULES:\n1. If the Caller says ANY meaningful words in the transcript, the call was answered.\n2. \"I'm busy\", \"busy right now\", \"not a good time\", \"I cannot talk\", \"can't talk\", or similar means the caller answered but is unavailable to continue. NEVER classify this as No Answer.\n3. No Answer is reserved for no meaningful caller speech, unanswered ringing, silence, or a true answering-machine/no-response event.\n4. Do not create a callback merely because a call was unanswered. Retry handling is separate.\n\nCALLBACK RULES:\n1. If an answered caller says they are busy/unavailable AND explicitly asks to be called back AND provides a usable time, callbackRequested MUST be true.\n2. Examples that MUST schedule a callback: \"I'm busy, call me tomorrow at 10\", \"not a good time, call me at 6 PM\", \"I'm busy right now, call me in 30 minutes\".\n3. If the caller only says \"I'm busy\" or \"call me later\" without a usable time, callbackRequested MUST be false. Do not invent a time.\n4. If the agent asks what time is convenient and the caller then supplies a time, that is a valid callback request.\n5. A bare hour such as \"10\" means 10:00 in the caller's local timezone; resolve to the next upcoming occurrence relative to {callerNow}.\n6. Relative phrases such as \"in 30 minutes\" belong in callbackRelativeMinutes.\n7. callbackRequested MUST be false whenever callbackTimeMentioned is false.\n8. No Answer and Callback Scheduled are mutually exclusive.\n\nENQUIRY RULES:\n1. Create an enquiry only for a meaningful caller question/request that the live agent genuinely could not answer or resolve.\n2. If the agent answered it successfully, enquiryRequested=false.\n3. Busy/callback, questionnaire answers, objections, silence, no-answer, wrong-number and ordinary conversation are not enquiries.\n4. An answered call may have BOTH a valid callback and an unresolved enquiry.\n\nDo not infer actions from the summary when the transcript contradicts it. The transcript is authoritative.",


  },
];
function validatePromptTemplate(id, systemPrompt) {
  const required = REQUIRED_PLACEHOLDERS[id] || [];
  const missing = required.filter((p) => !systemPrompt.includes(p));
  if (missing.length) {
    throw new Error(`System prompt must include ${missing.join(" and ")} — the pipeline substitutes the real value in at that exact spot; without it, this agent would run with no data.`);
  }
}

const MAX_SYSTEM_PROMPT_LENGTH = 50000;

async function getPromptOverrides(orgId) {
  if (!orgId) return {};
  const db = require("../db/repository");
  try {
    const org = await db.getOrg(orgId);
    return (org && org.systemAgentPrompts) || {};
  } catch (err) {
    throw err;
  }
}

// The prompt a given system agent should actually use for this org right
// now — the org's saved override if it has one, else the shared default.
// orgId is optional so callers with no org context (rare — e.g. a
// dev/browser session with no org) still get a sane default instead of
// having to special-case null.
async function getEffectivePrompt(orgId, id) {
  const def = SYSTEM_AGENTS.find((a) => a.id === id);
  if (!def) return null;
  const globalPrompt = (await getSetting(`prompt.system.${id}`, null)) || def.systemPrompt;
  if (!orgId) return globalPrompt;
  const overrides = await getPromptOverrides(orgId);
  return overrides[id] || globalPrompt;
}

// The full catalog, with each entry's systemPrompt swapped for this org's
// saved override where one exists — what GET /api/agents/system returns.
async function getEffectiveSystemAgents(orgId) {
  const overrides = await getPromptOverrides(orgId);
  return Promise.all(SYSTEM_AGENTS.map(async (a) => {
    const globalPrompt = (await getSetting(`prompt.system.${a.id}`, null)) || a.systemPrompt;
    return {
      ...a,
      systemPrompt: overrides[a.id] || globalPrompt,
      isCustomized: !!overrides[a.id],
      defaultSystemPrompt: globalPrompt,
    };
  }));
}

// Saves (or, given a blank/unchanged value, clears) this org's override
// for one system agent's prompt. Throws — the route turns that into a 400
// — if the id is unknown or the new prompt drops a required placeholder.
async function setPromptOverride(orgId, id, systemPrompt) {
  const def = SYSTEM_AGENTS.find((a) => a.id === id);
  if (!def) throw new Error(`Unknown system agent id "${id}"`);
  const db = require("../db/repository");
  const trimmed = (systemPrompt || "").trim();
  if (trimmed.length > MAX_SYSTEM_PROMPT_LENGTH) throw new Error(`System prompt exceeds the ${MAX_SYSTEM_PROMPT_LENGTH} character limit`);

  const globalPrompt = (await getSetting(`prompt.system.${id}`, null)) || def.systemPrompt;
  let stored = null;
  if (!trimmed || trimmed === globalPrompt.trim()) {
    stored = null;
  } else {
    validatePromptTemplate(id, trimmed);
    stored = trimmed;
  }
  await db.updateSystemAgentPrompt(orgId, id, stored);
  return { ...def, systemPrompt: stored || globalPrompt, isCustomized: !!stored, defaultSystemPrompt: globalPrompt };
}

module.exports = { SYSTEM_AGENTS, getEffectivePrompt, getEffectiveSystemAgents, setPromptOverride, validatePromptTemplate };
