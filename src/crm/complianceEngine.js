// ============================================================
// services/complianceEngine.js
//
// Do-Not-Call list + calling-window enforcement for outbound calls.
// Calling window lives in organizations.settings.callingWindow (jsonb,
// same pattern as voiceConfig) — no new table needed for that part.
// ============================================================

const db = require("../db/repository");

function requireSupabase() {
  if (!db.supabase) {
    const err = new Error("DNC list requires the MySQL database to be configured.");
    err.statusCode = 503;
    throw err;
  }
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "").slice(-10);
}

// ------------------------------------------------------------
// DNC list
// ------------------------------------------------------------

async function listDnc(orgId) {
  requireSupabase();
  const { data, error } = await db.supabase
    .from("dnc_entries")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[complianceEngine.listDnc] ${error.message}`);
  return (data || []).map((r) => ({ id: r.id, phone: r.phone, reason: r.reason, createdAt: r.created_at }));
}

async function addToDnc(orgId, phone, reason) {
  requireSupabase();
  if (!phone) {
    const err = new Error("phone is required");
    err.statusCode = 400;
    throw err;
  }
  const { data, error } = await db.supabase
    .from("dnc_entries")
    .insert({ org_id: orgId, phone, reason: reason || null })
    .select()
    .single();
  if (error) throw new Error(`[complianceEngine.addToDnc] ${error.message}`);
  return { id: data.id, phone: data.phone, reason: data.reason, createdAt: data.created_at };
}

async function removeFromDnc(orgId, id) {
  requireSupabase();
  const { error } = await db.supabase.from("dnc_entries").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw new Error(`[complianceEngine.removeFromDnc] ${error.message}`);
  return true;
}

async function isOnDncList(orgId, phone) {
  if (!db.supabase) return false; // dev fallback: compliance checks are opt-in, not enforceable without a real DB
  const target = normalizePhone(phone);
  if (!target) return false;
  const entries = await listDnc(orgId);
  return entries.some((e) => normalizePhone(e.phone) === target);
}

// ------------------------------------------------------------
// Calling window
// ------------------------------------------------------------

const DEFAULT_CALLING_WINDOW = { enabled: false, startHour: 9, endHour: 20, timezone: "Asia/Kolkata" };

async function getCallingWindow(orgId) {
  if (!db.supabase) return DEFAULT_CALLING_WINDOW;
  const org = await db.getOrg(orgId);
  return (org && org.callingWindow) || DEFAULT_CALLING_WINDOW;
}

async function updateCallingWindow(orgId, patch) {
  requireSupabase();
  const existing = await getCallingWindow(orgId);
  const merged = { ...existing, ...patch };
  await db.updateOrg(orgId, { callingWindow: merged });
  return merged;
}

// Returns { allowed: boolean, reason?: string }. Disabled windows (the
// default) always allow — this is opt-in compliance, not a default
// restriction that could unexpectedly block a fresh org's first call.
async function checkCallingWindow(orgId) {
  const window = await getCallingWindow(orgId);
  if (!window.enabled) return { allowed: true };

  const hourStr = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: window.timezone }).format(new Date());
  const currentHour = parseInt(hourStr, 10) % 24; // Intl can return "24" for midnight depending on locale/ICU version

  const withinWindow = window.startHour <= window.endHour
    ? currentHour >= window.startHour && currentHour < window.endHour
    : currentHour >= window.startHour || currentHour < window.endHour; // window spans midnight

  if (!withinWindow) {
    return { allowed: false, reason: `Outside allowed calling hours (${window.startHour}:00–${window.endHour}:00 ${window.timezone}).` };
  }
  return { allowed: true };
}

// Combined pre-call check used by the outbound call routes.
async function checkOutboundCallAllowed(orgId, phone) {
  const onDnc = await isOnDncList(orgId, phone);
  if (onDnc) return { allowed: false, reason: "This number is on the Do-Not-Call list." };
  return checkCallingWindow(orgId);
}

module.exports = {
  listDnc,
  addToDnc,
  removeFromDnc,
  isOnDncList,
  getCallingWindow,
  updateCallingWindow,
  checkCallingWindow,
  checkOutboundCallAllowed
};
