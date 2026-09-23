// ============================================================
// services/pricing.js
//
// Per-minute AI voice cost, billed in INR. Not tied to any real
// payment processor (billingEngine.js doesn't collect payments) —
// this is a cost estimate derived from real call/usage minutes.
//
// This used to be its own manually-set platform setting, independent of
// the Cost page's per-provider rates. It's now derived live from
// whichever call provider is active there (platform/costProviders.js),
// so a future provider with a different rate flows straight into every
// org-facing "AI voice cost" display the moment it's marked active —
// no separate number to keep in sync by hand.
// ============================================================

const platformSettings = require("./settings");

async function getCostPerMinuteInr() {
  // Lazily required to avoid a circular require (costProviders ->
  // platform/settings -> db/repository -> pricing, same cycle
  // phoneCostForSeconds below avoids).
  const { getPrimaryCallProviderRate } = require("./costProviders");
  return getPrimaryCallProviderRate();
}

async function costForMinutes(minutes) {
  const rate = await getCostPerMinuteInr();
  return Math.round((minutes || 0) * rate * 100) / 100;
}

async function costForSeconds(seconds) {
  return costForMinutes((seconds || 0) / 60);
}

// Same idea, for telephony (Vobiz) per-minute cost — kept as
// a separate rate/setting from the AI voice cost above since they're
// billed by different parties (the telephony provider vs. Google), even
// though both are ultimately keyed off the same call duration. Feeds
// organizations.phone_charges (see db.incrementPhoneCharges), the
// "Phone Charges" figure on Billing & Usage, which previously never
// changed from its initial 0/seed value because nothing ever computed
// or wrote to it.
const PHONE_PRICING_KEY = "pricing.phone_cost_per_minute";
const DEFAULT_PHONE_COST_PER_MINUTE = 8;

async function getPhoneCostPerMinute() {
  return platformSettings.getSetting(PHONE_PRICING_KEY, DEFAULT_PHONE_COST_PER_MINUTE);
}

async function setPhoneCostPerMinute(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw new Error("phone_cost_per_minute must be a non-negative number");
  return platformSettings.setSetting(PHONE_PRICING_KEY, num);
}

async function phoneCostForMinutes(minutes) {
  const rate = await getPhoneCostPerMinute();
  return Math.round((minutes || 0) * rate * 100) / 100;
}

async function phoneCostForSeconds(seconds) {
  // Prefer the new per-provider Cost page (platform/costProviders.js) once
  // a super admin has actually set a rate there — required lazily to avoid
  // a circular require (costProviders -> platform/settings -> db/repository,
  // same cycle pricing.js itself avoids elsewhere). Falls back to the
  // legacy flat rate below when no "vobiz" call-provider rate is set yet,
  // so behavior is unchanged for any org until an admin opts in.
  try {
    const { computeCallCost } = require("./costProviders");
    const result = await computeCallCost({ providerKey: "vobiz", seconds });
    if (result) return result.totalCost;
  } catch (err) {
    // fall through to legacy flat pricing below
  }
  return phoneCostForMinutes((seconds || 0) / 60);
}

module.exports = {
  getCostPerMinuteInr,
  costForMinutes,
  costForSeconds,
  DEFAULT_PHONE_COST_PER_MINUTE,
  getPhoneCostPerMinute,
  setPhoneCostPerMinute,
  phoneCostForMinutes,
  phoneCostForSeconds,
};
