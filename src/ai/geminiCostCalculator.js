// src/ai/geminiCostCalculator.js
// ============================================================
// Dedicated cost-calculation module — the ONLY place that turns token
// counts into a dollar figure. Nothing in the Gemini Live connection
// code (vobizProxy.js etc) or the usage tracker (geminiUsageTracker.js)
// does its own arithmetic; they all call calculateGeminiCost() here.
//
// IMPORTANT: every value this module returns is an APPLICATION-LEVEL
// ESTIMATE — computed from the token counts the SDK reports and the
// prices in geminiPricing.js. It is not, and must never be presented as,
// the authoritative Google Cloud invoice amount. See
// docs/ai-usage-tracking.md for the full explanation of why the two can
// diverge, and ai_session_usage's actual_billed_cost/reconciliation_*
// columns for where a future reconciliation job would record the real
// billed figure alongside this estimate.
// ============================================================

const { getModelPricing, PRICING_VERSION, DEFAULT_CURRENCY } = require("./geminiPricing");

/**
 * @param {Object} params
 * @param {string} params.model
 * @param {number} params.inputTokens
 * @param {number} params.outputTokens
 * @returns {{ inputCost: number, outputCost: number, totalCost: number, currency: string, pricingVersion: string, estimated: true }}
 */
function calculateGeminiCost({ model, inputTokens, outputTokens }) {
  const safeInputTokens = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const safeOutputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  const pricing = getModelPricing(model);

  const inputCost = (safeInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (safeOutputTokens / 1_000_000) * pricing.outputPerMillion;

  return {
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    totalCost: roundCost(inputCost + outputCost),
    currency: DEFAULT_CURRENCY,
    pricingVersion: PRICING_VERSION,
    // Explicit marker carried alongside the numbers themselves so a
    // caller that only has the return value in hand (e.g. serialized into
    // an API response) can't accidentally present this as anything other
    // than an estimate without the flag saying otherwise being right there.
    estimated: true,
  };
}

// 6 decimal places — at $3-12 per million tokens, a single-digit token
// count still needs sub-cent precision to not round to zero.
function roundCost(value) {
  return Math.round(value * 1e6) / 1e6;
}

module.exports = { calculateGeminiCost };
