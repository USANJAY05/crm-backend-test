// src/ai/postCallAgents/summaryAgent.js
// ============================================================
// Post-call AI summary — the text shown in Call Logs, plus a structured
// outcome classification.
// ============================================================

const { z } = require("zod");
const { getEffectivePrompt } = require("../systemAgents");
const { generateStructured, formatWorkflowAnswers } = require("./shared");
const { getCallerTimezone } = require("../../lib/callerTimezone");
const { nowInTimezone, zonedTimeToUtc } = require("../../lib/timezoneConvert");

const SummarySchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  outcome: z.enum([
    "Interested", "Not Interested", "Callback Requested",
    "No Answer", "Wrong Number", "Incomplete",
  ]).default("Incomplete"),
  callerName: z.string().nullable().default(null),
});

async function generateCallSummary(transcript, orgId = null, workflowAnswers = [], onUsage, callerPhone = null) {
  if (!transcript?.trim()) return null;
  let template = await getEffectivePrompt(orgId, "call-summarizer");
  const timeZone = getCallerTimezone(callerPhone);
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

  let text = parsed.summary;
  if (parsed.keyPoints.length) text += "\n\nKey Points:\n" + parsed.keyPoints.map(p => `• ${p}`).join("\n");
  text += `\n\nOutcome: ${parsed.outcome}`;

  return {
    ...parsed,
    text,
  };
}
module.exports = { generateCallSummary };
