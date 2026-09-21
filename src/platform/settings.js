// ============================================================
// services/platformSettings.js
//
// Generic key/value store (platform_settings table) for anything the
// super admin panel needs to control live, without a redeploy:
// pricing, feature flags, etc. Backed by MySQL via db.supabase,
// with a short in-memory cache so hot paths (billing on every call)
// don't hit the DB on every read.
// ============================================================

const db = require("../db/repository");
const { getLogger } = require("../observability/logger");
const log = getLogger("platform.settings");

const CACHE_TTL_MS = 15000;
const cache = new Map(); // key -> { value, expiresAt }

async function getSetting(key, defaultValue) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!db.supabase) return defaultValue;
  try {
    const { data, error } = await db.supabase
      .from("platform_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(`[platformSettings.getSetting] ${error.message || "Database error"}`);
    if (!data) {
      cache.set(key, { value: defaultValue, expiresAt: Date.now() + CACHE_TTL_MS });
      return defaultValue;
    }
    cache.set(key, { value: data.value, expiresAt: Date.now() + CACHE_TTL_MS });
    return data.value;
  } catch (err) {
    log.error(`⚠️ platformSettings.getSetting(${key}) failed:`, err.message);
    throw err;
  }
}

async function setSetting(key, value) {
  if (!db.supabase) throw new Error("Database not configured");
  const { error } = await db.supabase
    .from("platform_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message || "Failed to save setting");
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getAllSettings(prefix) {
  if (!db.supabase) return [];
  const { data, error } = await db.supabase.from("platform_settings").select("*");
  if (error || !data) return [];
  return prefix ? data.filter((row) => row.key.startsWith(prefix)) : data;
}

module.exports = { getSetting, setSetting, getAllSettings };
