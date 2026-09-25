const { getSetting, setSetting } = require("./settings");
const { listIndustries } = require("../seed/industryPacks");

const KEY = "billing.callBalancePolicy";
const FALLBACK_MINUTES = 1;
const FALLBACK_MIN_BALANCE_INR = 0;

function money(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function normalizeEntry(input = {}) {
  const minimumBalanceInr = money(input.minimumBalanceInr);
  const reservationMinutes = Math.max(1, Number(input.reservationMinutes) || FALLBACK_MINUTES);
  return { minimumBalanceInr, reservationMinutes };
}

function defaultCatalog() {
  return listIndustries().reduce((acc, industry) => {
    acc[industry.key] = {
      industry: industry.key,
      label: industry.label,
      minimumBalanceInr: FALLBACK_MIN_BALANCE_INR,
      reservationMinutes: FALLBACK_MINUTES,
    };
    return acc;
  }, {});
}

async function getIndustryDefaults() {
  const stored = await getSetting(KEY, {});
  const catalog = defaultCatalog();
  for (const [key, value] of Object.entries(stored && typeof stored === "object" ? stored : {})) {
    if (!catalog[key]) {
      catalog[key] = { industry: key, label: key, ...normalizeEntry(value) };
    } else {
      catalog[key] = { ...catalog[key], ...normalizeEntry(value) };
    }
  }
  return catalog;
}

async function setIndustryDefault(industry, input) {
  const key = String(industry || "").trim();
  if (!key) throw Object.assign(new Error("Industry is required"), { statusCode: 400 });
  const catalog = await getIndustryDefaults();
  const current = catalog[key] || { industry: key, label: key };
  catalog[key] = { ...current, ...normalizeEntry(input) };
  const saved = {};
  for (const [k, v] of Object.entries(catalog)) saved[k] = normalizeEntry(v);
  await setSetting(KEY, saved);
  return catalog[key];
}

async function removeIndustryDefault(industry) {
  const catalog = await getIndustryDefaults();
  const defaults = defaultCatalog();
  if (!defaults[industry]) throw Object.assign(new Error("Unknown industry"), { statusCode: 400 });
  delete catalog[industry];
  const saved = {};
  for (const [k, v] of Object.entries(catalog)) {
    if (!defaults[k] || v.minimumBalanceInr !== defaults[k].minimumBalanceInr || v.reservationMinutes !== defaults[k].reservationMinutes) {
      saved[k] = normalizeEntry(v);
    }
  }
  await setSetting(KEY, saved);
  return { industry, ...defaults[industry] };
}

async function getOrganizationPolicy(orgId) {
  const db = require("../db/repository");
  const org = await db.getOrg(orgId);
  if (!org) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  const { data: row, error } = await db.supabase.from("organizations").select("settings, industry").eq("id", orgId).maybeSingle();
  if (error) throw new Error(`[callBalancePolicy.getOrganizationPolicy] ${error.message}`);
  const defaults = await getIndustryDefaults();
  const industry = row?.industry || org.industry || "lending";
  const base = defaults[industry] || { industry, label: industry, minimumBalanceInr: 0, reservationMinutes: 1 };
  const override = row?.settings?.billing?.callBalance;
  return {
    orgId,
    industry,
    industryDefault: normalizeEntry(base),
    override: override ? normalizeEntry(override) : null,
    effective: normalizeEntry(override || base),
  };
}

async function setOrganizationPolicy(orgId, input = {}) {
  const db = require("../db/repository");
  const org = await db.getOrg(orgId);
  if (!org) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  const settings = org.settings && typeof org.settings === "object" ? { ...org.settings } : {};
  settings.billing = { ...(settings.billing || {}), callBalance: normalizeEntry(input) };
  await db.supabase.from("organizations").update({ settings }).eq("id", orgId);
  return getOrganizationPolicy(orgId);
}

async function clearOrganizationPolicy(orgId) {
  const db = require("../db/repository");
  const org = await db.getOrg(orgId);
  if (!org) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  const settings = org.settings && typeof org.settings === "object" ? { ...org.settings } : {};
  if (settings.billing) {
    settings.billing = { ...settings.billing };
    delete settings.billing.callBalance;
    if (!Object.keys(settings.billing).length) delete settings.billing;
  }
  await db.supabase.from("organizations").update({ settings }).eq("id", orgId);
  return getOrganizationPolicy(orgId);
}

module.exports = {
  getIndustryDefaults,
  setIndustryDefault,
  removeIndustryDefault,
  getOrganizationPolicy,
  setOrganizationPolicy,
  clearOrganizationPolicy,
  normalizeEntry,
};
