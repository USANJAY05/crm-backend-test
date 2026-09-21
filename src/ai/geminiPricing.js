// src/ai/geminiPricing.js
// ============================================================
// Pricing configuration for Gemini/Vertex AI cost estimation — the ONE
// place model prices live. Nothing in geminiCostCalculator.js or the
// session-tracking code hard-codes a dollar figure; when Google changes
// pricing, this file is the only thing that needs an update.
//
// Prices verified against Google's published Gemini API pricing page for
// native-audio models at the time this was written (see PRICING_VERSION
// below) — $ per 1,000,000 tokens, USD. These are ChiefVoice's OWN
// estimates for internal usage tracking, not a live price feed from
// Google, and are not guaranteed to match your actual Google Cloud
// invoice — see docs/ai-usage-tracking.md for why the two can differ
// (rounding, promotional pricing, context-caching discounts, non-token
// charges like audio-input surcharges the Live API may apply that aren't
// reflected in the SDK's token-count usageMetadata at all).
// ============================================================

// Bump this whenever MODEL_PRICING below changes. Every cost calculation
// this module produces is stamped with the version that was active at
// calculation time (ai_session_usage.pricing_version) — so historical
// records keep reading correctly even after prices change, and a
// reporting query can tell "was this calculated under the old or new
// pricing" without guessing from the date alone.
const PRICING_VERSION = "2026-01-gemini-v1";

const DEFAULT_CURRENCY = "USD";

// $ per 1,000,000 tokens. Matches the constants already used inline in
// vobizProxy.js/twilioProxy.js/piopiyProxy.js's own (separate, pre-existing)
// cost-logging — kept identical on purpose so this module's numbers agree
// with what those existing log lines already report, rather than
// introducing a second, conflicting cost figure for the same call.
const MODEL_PRICING = {
  "gemini-live-2.5-flash-native-audio": { inputPerMillion: 3.00, outputPerMillion: 12.00 },
  "gemini-2.5-flash-native-audio-latest": { inputPerMillion: 3.00, outputPerMillion: 12.00 },
  "gemini-2.5-flash-native-audio-preview": { inputPerMillion: 3.00, outputPerMillion: 12.00 },
  // Used by src/ai/postCallAgents.js's post-call text agents (sentiment,
  // summary, extraction) — different model, different price, tracked
  // separately from the Live session's own audio-model usage.
  "gemini-2.5-flash-lite": { inputPerMillion: 0.10, outputPerMillion: 0.40 },
};

// Applied when a model isn't in MODEL_PRICING at all — better than
// silently reporting a $0 cost for real usage. Priced deliberately
// pessimistic (same as the native-audio models above) so an unrecognized
// model shows up as a real cost to investigate, not a suspiciously free one.
const FALLBACK_PRICING = { inputPerMillion: 3.00, outputPerMillion: 12.00 };

function getModelPricing(model) {
  return MODEL_PRICING[model] || FALLBACK_PRICING;
}

module.exports = {
  PRICING_VERSION,
  DEFAULT_CURRENCY,
  MODEL_PRICING,
  FALLBACK_PRICING,
  getModelPricing,
};
