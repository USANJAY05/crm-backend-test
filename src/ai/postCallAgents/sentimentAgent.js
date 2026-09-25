// src/ai/postCallAgents/sentimentAgent.js
// ============================================================
// Post-call sentiment classification — Positive/Neutral/Negative/null.
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
const { generateStructured, log, formatWorkflowAnswers } = require("./shared");

const SentimentSchema = z.object({
  sentiment: z.union([z.enum(["Positive", "Neutral", "Negative"]), z.null()]),
});

async function analyzeSentiment(transcript, orgId = null, workflowAnswers = []) {
  if (!transcript?.trim()) return { sentiment: null, inputTokens: 0, outputTokens: 0 };
  try {
    const template = await getEffectivePrompt(orgId, "sentiment-analyzer");
    const prompt = template
      .replace("{workflowAnswers}", formatWorkflowAnswers(workflowAnswers))
      .replace("{transcript}", transcript);
    let inputTokens = 0;
    let outputTokens = 0;
    const parsed = await generateStructured({
      label: "sentiment",
      orgId,
      prompt,
      schema: SentimentSchema,
      fallback: { sentiment: null },
      onUsage: ({ inputTokens: i, outputTokens: o }) => { inputTokens = i; outputTokens = o; },
    });
    return { sentiment: parsed?.sentiment ?? null, inputTokens, outputTokens };
  } catch (err) {
    log.error("❌ [postCallAgents:sentiment] error:", err.message);
    return { sentiment: null, inputTokens: 0, outputTokens: 0 };
  }
}

module.exports = { analyzeSentiment };
