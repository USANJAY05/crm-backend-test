// src/ai/postCallAgents/sentimentAgent.js
// ============================================================
// Post-call sentiment classification — Positive/Neutral/Negative/null.
// null is intentional for busy/callback-only calls or calls with insufficient
// genuine caller interaction. The database sentiment field is nullable text,
// so no sentinel such as "Unknown" is required.
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
