// ============================================================
// services/auditLog.js
//
// Records admin-sensitive actions for compliance/accountability —
// see schema_part10_audit_log.sql. Deliberately scoped to actions
// an enterprise buyer would actually ask "who did this and when":
// org settings, team/role changes, DNC list, calling window, persona
// config, channel connections, custom object schema changes. Not a
// generic activity feed for every CRUD operation.
// ============================================================

const db = require("../db/repository");
const { getLogger, redact } = require("../observability/logger");
const log = getLogger("platform.auditLog");

// Never throws — a failed audit write should never break the action it's
// logging. Silent no-op in dev fallback (no Supabase configured).
async function record(orgId, actor, action, targetType, targetId, metadata = {}) {
  if (!db.supabase) return;
  try {
    await db.supabase.from("audit_log").insert({
      org_id: orgId,
      actor_user_id: actor?.userId || null,
      actor_email: actor?.userEmail || null,
      action,
      target_type: targetType || null,
      target_id: targetId ? String(targetId) : null,
      metadata: redact(metadata)
    });
  } catch (err) {
    log.error("❌ auditLog.record failed:", err.message);
  }
}

// Pass { page, limit } (both required together) to page server-side —
// response becomes { rows, total } instead of a plain array. Omit them
// (or pass just the old { limit }) to keep the existing plain-array,
// capped-at-`limit` behavior every current caller relies on.
async function list(orgId, { page, limit = 100 } = {}) {
  if (!db.supabase) return page ? { rows: [], total: 0 } : [];
  const paginate = Number.isInteger(page) && page > 0;

  let query = db.supabase
    .from("audit_log")
    .select("*", paginate ? { count: "exact" } : undefined)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (paginate) {
    const from = (page - 1) * limit;
    query = query.range(from, from + limit - 1);
  } else {
    query = query.limit(limit);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`[auditLog.list] ${error.message}`);
  const rows = (data || []).map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata,
    createdAt: r.created_at
  }));
  return paginate ? { rows, total: count ?? rows.length } : rows;
}

module.exports = { record, list };
