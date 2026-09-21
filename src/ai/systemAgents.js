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
  "call-summarizer": ["{transcript}", "{workflowAnswers}"],
  "workflow-answer-extractor": ["{transcript}", "{questions}"],
  "follow-up-safety-net": ["{transcript}", "{callerNow}"],
};

const { getSetting } = require("../platform/settings");

const SYSTEM_AGENTS = [
  {
    id: "sentiment-analyzer",
    name: "Sentiment Analyzer",
    description: "Classifies every finished call as Positive, Neutral, Negative, or Unknown — shown on every call log and used for the Reports dashboard's sentiment breakdown.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are judging a completed AI voice call's sentiment. Use BOTH the transcript AND the workflow questions already answered during the call — a caller who genuinely engaged with and completed a questionnaire is a positive signal on its own, even if the transcript itself is short.\n\nWorkflow answers captured during this call:\n{workflowAnswers}\n\nTranscript:\n{transcript}\n\nDecide exactly one of these four values:\n\n\"Unknown\" — the caller was busy right now and asked to be called back later (e.g. \"I'm busy, call me later\", \"can you try after 6pm\"). There wasn't a real conversation to judge sentiment from yet, so don't guess — this is not the same as Neutral.\n\n\"Negative\" — the caller CLEARLY did not want this call, this product, or this service: they explicitly declined, refused, asked to not be contacted again, got annoyed or hostile, or firmly said no when asked to proceed. A caller who was simply lukewarm, gave short answers, or said \"not interested right now\" WITHOUT any of the above is NOT Negative — that's Neutral.\n\n\"Positive\" — the caller engaged with the call: they answered the workflow questions asked of them (completing some or all of the questionnaire above counts strongly toward this), agreed to next steps, or — especially — kept asking their OWN follow-up questions even after every workflow question had already been answered (that extra engagement past what was required is a strong positive signal on its own).\n\n\"Neutral\" — everything else: a real conversation happened (so not Unknown) but it doesn't clearly show either the engagement of Positive or the explicit rejection of Negative — e.g. a polite wrong number, an inconclusive call, or one cut short with no clear stance either way.\n\nReply with ONLY one word: Unknown, Negative, Positive, or Neutral.",
    tools: [],
    runsOn: "After every call ends, before the call_logs row is written (src/ai/postCallAgents/sentimentAgent.js:analyzeSentiment)",
  },
  {
    id: "call-summarizer",
    name: "Call Summarizer",
    description: "Writes the 2-3 sentence summary, key points, and outcome classification shown on every call log.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "You are summarizing a completed AI voice call for someone who wasn't on it. Use BOTH the transcript AND the workflow questions already answered during the call — mention concretely what was learned (using the actual values captured), not just that \"questions were asked\".\n\nReply with ONLY a valid JSON object — no markdown, no extra text — with these fields:\n{\n  \"summary\": \"2-3 sentence plain-English summary: who called/was called, what was discussed, and the concrete outcome — reference specific captured answers where they matter (e.g. \\\"interested in a 1 Crore term policy, budget around 50000/year\\\") instead of vague generalities\",\n  \"keyPoints\": [\"one short bullet per concrete, useful fact or decision from the call — a captured answer, an objection raised, a commitment made — not restatements of the summary\"],\n  \"outcome\": \"Interested | Not Interested | Callback Requested | No Answer | Wrong Number | Incomplete\"\n}\n\nFor \"outcome\": prefer \"Callback Requested\" whenever the caller asked to be called back later (even if they were also engaged and positive) — that's the actionable state, not \"Interested\". Use \"Incomplete\" when the questionnaire below has answers missing and the transcript doesn't explain why (not simply because the call was short).\n\nWorkflow answers captured during this call:\n{workflowAnswers}\n\nTranscript:\n{transcript}",
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
    name: "Follow-Up Safety Net",
    description: "Re-reads the finished transcript to catch a promised callback or a caller's name the live call learned but never saved, and — if the caller said they were busy and asked to be called back — when to try again. Live audio tool-calling isn't 100% reliable, so this is the backstop.",
    model: "gemini-2.5-flash-lite",
    systemPrompt: "The caller's own current local date/time (already resolved to their timezone) is {callerNow} — a wall-clock reading, formatted YYYY-MM-DDTHH:mm:ss. Read this call transcript. Reply with ONLY a compact JSON object, no markdown, no explanation:\n{\"followUpPromised\": true|false, \"callerName\": \"name or null\", \"querySummary\": \"one short sentence of what the caller wanted, or null\", \"callbackRequested\": true|false, \"callbackRelativeMinutes\": number or null, \"callbackLocalDateTime\": \"YYYY-MM-DDTHH:mm:ss or null\"}\n\nFirst decide \"callbackRequested\": true ONLY if the CALLER indicated — at ANY point in the call, in ANY wording — that now isn't a good time and they want to be called back later by the same AI agent. Read the WHOLE transcript for this, not just one line — the busy/reschedule request and the actual time often land in DIFFERENT turns (caller says they're busy, the agent asks what time works, and only THEN does the caller give a time) and both turns together still count as one callback, not two separate things. This covers the obvious phrasing (\"I'm busy, call me later\", \"can you try again after 6pm\", \"I'm driving, call after 5\", \"call me again tomorrow\") AND the softer/indirect versions (\"I can't talk right now\", \"this isn't a good time\", \"can we do this another time\", \"call me back\") AND — this is the case most often missed — simply the agent asking \"what time should I call you back?\" or similar and the caller answering with a name and/or a time, with no other explicit \"busy\" wording at all: that exchange on its own is still enough, because the agent only asks that question when a callback was already implied. If the caller gives a callback time anywhere in the transcript, this is a callback — do not let a missing literal word like \"busy\" push it to followUpPromised/enquiry instead. This must never also be treated as a human hand-off, even if the caller also asked a question earlier in the same call — this always wins over followUpPromised below.\n\nIMPORTANT — do NOT set callbackRequested just because the call went unanswered or the caller barely engaged (silence, an immediate hang-up, background noise with no reply, a wrong number, or a call that never really connected). That is a completely different outcome (\"No Answer\"), already tracked and automatically retried elsewhere from the call's own connection status — it does not need this agent to schedule anything, and doing so here would double up with that separate mechanism. Only set callbackRequested when the CALLER, having actually engaged in a real conversation, asked for a later callback as described above.\n\nOnly if callbackRequested is false, decide \"followUpPromised\": true in EXACTLY ONE case: the CALLER asked a specific question or made a request that the AGENT genuinely did NOT know the answer to and could not actually resolve on the call itself — the agent said it didn't know, gave an uncertain/deflecting answer, said it would need to check with someone, or simply had no relevant information to give. This is the ONLY reason to raise an enquiry: something a human now needs to go answer, because the AI agent itself couldn't. If the agent told the caller \"someone will follow up\" or \"I'll forward this to the team\", that promise only counts here if it was actually made BECAUSE the agent didn't know something — not as a generic closing pleasantry, and not for something the agent was actually able to answer or handle itself on the call.\nDo NOT set followUpPromised in any of these cases — none of them are an unresolved question for a human to answer:\n- The call happened normally with no unanswered question at all.\n- The caller answered some or all of the workflow/questionnaire questions asked of them — completing (or partially completing) a questionnaire is a normal, successful call outcome (it advances the contact to a lead), not an enquiry, even if the agent didn't explicitly resolve every last thing the caller said.\n- On an OUTBOUND call (the business called the caller), the caller agreed to something, scheduled something, gave a clear yes/no, or simply said they weren't interested — any of these is a normal, successful outbound outcome, not an enquiry, REGARDLESS of how warmly or curtly the caller said it. A caller's tone alone (short, blunt, uninterested, even mildly annoyed) is never on its own a reason to set followUpPromised — only an actual question or request the agent could not answer is.\n- The callback case above (already fully covered by callbackRequested) — a scheduled callback time belongs there, never here.\n- A call that never really connected (see above — that's neither a callback nor an enquiry, just leave both false).\nWhen followUpPromised is true, \"querySummary\" must state the actual question or request the agent couldn't resolve, not a generic summary of the call.\n\nWhen callbackRequested is true, fill in EXACTLY ONE of these two (never both — leave the other null):\n\n\"callbackRelativeMinutes\" — use this when the caller gave a RELATIVE delay from right now (\"in 30 minutes\", \"after an hour\", \"give me 15 minutes\"). Just the number of minutes — do NOT try to compute a resulting clock time yourself, that happens elsewhere. \"an hour\" = 60, \"half an hour\" = 30, etc.\n\n\"callbackLocalDateTime\" — use this when the caller gave a SPECIFIC time and/or date (\"call me at 5pm\", \"tomorrow morning\", \"Monday at 10\", \"tonight around 8\"). Resolve it against {callerNow} (their own local \"now\", not a UTC clock) and reply with a plain wall-clock string in the exact format YYYY-MM-DDTHH:mm:ss — no \"Z\", no timezone offset, no other formatting. \"Morning\"/\"afternoon\"/\"evening\" with no exact hour: pick a reasonable representative time (9am / 2pm / 6pm respectively).\n\nIf the caller only said something vague with no way to compute either (\"later\", \"some other time\", \"whenever\"), leave BOTH null.\n\n{transcript}",
    tools: [],
    runsOn: "After every call ends, only for calls with a transcript and an org (src/ai/postCallAgents.js:extractFollowUp)",
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
