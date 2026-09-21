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
});

async function generateCallSummary(transcript, orgId = null, workflowAnswers = [], onUsage) {
  if (!transcript?.trim()) return null;
  const template = await getEffectivePrompt(orgId, "call-summarizer");
  const prompt = template
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
  return { ...parsed, text };
}

module.exports = { generateCallSummary };
