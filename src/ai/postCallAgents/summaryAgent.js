// src/ai/postCallAgents/summaryAgent.js
// ============================================================
// Post-call AI summary — the text shown in Call Logs, plus a structured
// outcome classification.
// ============================================================

const { z } = require("zod");
const { getEffectivePrompt } = require("../systemAgents");
const { generateStructured, formatWorkflowAnswers } = require("./shared");

const SummarySchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  outcome: z.enum([
    "Interested", "Not Interested", "Callback Requested",
    "No Answer", "Wrong Number", "Incomplete",
  ]).default("Incomplete"),
  callerName: z.string().nullable().default(null),
  callbackRequested: z.boolean().default(false),
  callbackRelativeMinutes: z.number().nullable().default(null),
  callbackLocalDateTime: z.string().nullable().default(null),
  enquiryRequested: z.boolean().default(false),
  enquirySummary: z.string().nullable().default(null),
});

async function generateCallSummary(transcript, orgId = null, workflowAnswers = [], onUsage, callerPhone = null) {
  if (!transcript?.trim()) return null;
  let template = await getEffectivePrompt(orgId, "call-summarizer");
  const timeZone = getCallerTimezone(callerPhone);
  // Older org-specific prompt overrides may predate the callback fields and
  // therefore not contain {callerNow}. Keep those prompts usable by adding
  // the missing context instead of silently giving the model no local time.
  if (!template.includes("{callerNow}")) {
    template += "\n\nCaller local date/time: {callerNow}";
  }
  const prompt = template
    .replace("{callerNow}", nowInTimezone(timeZone))
    .replace("{workflowAnswers}", formatWorkflowAnswers(workflowAnswers))
    .replace("{transcript}", transcript);
  const parsed = await generateStructured({
    label: "summary",
    orgId,
    prompt,
    schema: SummarySchema,
    fallback: null,
    onUsage,
  });
  if (!parsed) return null;

  let callbackTime = null;
  if (parsed.callbackRequested) {
    if (typeof parsed.callbackRelativeMinutes === "number" && parsed.callbackRelativeMinutes > 0) {
      callbackTime = new Date(Date.now() + parsed.callbackRelativeMinutes * 60000).toISOString();
    } else if (parsed.callbackLocalDateTime) {
      const resolved = zonedTimeToUtc(parsed.callbackLocalDateTime, timeZone);
      if (resolved && resolved.getTime() > Date.now()) callbackTime = resolved.toISOString();
    }
  }

  // The summary is now the canonical post-call outcome record. A callback
  // always wins over an enquiry; an unresolved question is an enquiry only
  // when no callback was requested.
  const callbackRequested = parsed.callbackRequested || parsed.outcome === "Callback Requested";
  const enquiryRequested = !callbackRequested && parsed.enquiryRequested;

  let text = parsed.summary;
  if (parsed.keyPoints.length) text += "\n\nKey Points:\n" + parsed.keyPoints.map(p => `• ${p}`).join("\n");
  text += `\n\nOutcome: ${callbackRequested ? "Callback Requested" : parsed.outcome}`;
  return {
    ...parsed,
    callbackRequested,
    callbackTime,
    enquiryRequested,
    querySummary: parsed.enquirySummary,
    text,
  };
}
module.exports = { generateCallSummary };
