// ============================================================
// services/workflowEngine.js
//
// Executes a workflow (from the existing `workflows` table's
// nodes/edges jsonb — see WorkflowBuilderView.tsx) against one lead.
//
// DELIBERATELY manual-trigger-only, not auto-run on lead creation —
// see services/workflowRoutes.js. Two node types are never executed
// automatically, only logged as needing a human:
//   - "call"     — placing a real outbound AI call is left to a human
//                  explicitly using the dialer, not auto-dialed by a
//                  workflow run.
//   - "question" — needs a live back-and-forth conversation to
//                  collect an answer; nothing to execute outside one.
// "action" nodes (tag/close/assign/send WhatsApp) and "decision"
// nodes (branch on the lead's current status) DO execute for real.
// ============================================================

const db = require("../db/repository");
const objectsEngine = require("./objectsEngine");
const channelsEngine = require("../channels/engine");
const whatsapp = require("../channels/whatsapp");
const complianceEngine = require("./complianceEngine");

// Phase 4 (see PHASE4_MIGRATION_PLAN.md): once an org's leads live in
// object_records (the "lending_lead" object from industryPacks.js's
// LENDING_PACK) instead of the legacy `leads` table, this engine still
// needs to run existing workflow definitions against them unchanged.
// loadLead/patchLead are the only two places that know which backend a
// given lead actually lives in — everything else in this file keeps
// working against the same {id, name, phone, tags, notes, status} shape
// either way. No org can reach the "objects" path yet (LENDING_PACK isn't
// wired into signup), so this is forward compatibility, not a behavior
// change for any lead sourced from the legacy table today.
const LENDING_LEAD_OBJECT_KEY = "lending_lead";

function objectRecordToLeadShape(record, stagesById) {
  const stage = record.stageId ? stagesById.get(record.stageId) : null;
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    notes: record.notes || "",
    tags: Array.isArray(record.tags) ? record.tags : [],
    status: stage ? stage.label : null,
    _source: "objects",
    _stages: stagesById
  };
}

// Finds a lead by id, trying the legacy `leads` table first (today's only
// real path) and falling back to the generic lending_lead object.
async function loadLead(orgId, leadId) {
  const leads = await db.list("leads", orgId);
  const legacyLead = leads.find((l) => l.id === leadId);
  if (legacyLead) return { ...legacyLead, _source: "legacy" };

  const object = await objectsEngine.getObjectByKey(orgId, LENDING_LEAD_OBJECT_KEY);
  if (!object) return null;
  const records = await objectsEngine.listRecords(orgId, LENDING_LEAD_OBJECT_KEY);
  const record = records.find((r) => r.id === leadId);
  if (!record) return null;
  const stagesById = new Map(object.stages.map((s) => [s.id, s]));
  return objectRecordToLeadShape(record, stagesById);
}

// Applies a {status?, tags?, notes?} patch back to whichever backend the
// lead came from. `status` on an objects-backed lead is translated to a
// stage change by matching the target status text against a stage label
// (case-insensitive); if no matching stage exists the status part of the
// patch is dropped rather than guessing.
async function patchLead(orgId, lead, patch) {
  if (lead._source !== "objects") {
    return { ...lead, ...(await db.patch("leads", orgId, lead.id, patch)) };
  }

  const { status, ...rest } = patch;
  const body = { ...rest };
  if (status) {
    const stage = Array.from(lead._stages.values()).find((s) => s.label.toLowerCase() === status.toLowerCase());
    if (stage) body.stageKey = stage.key;
  }
  const updated = await objectsEngine.patchRecord(orgId, LENDING_LEAD_OBJECT_KEY, lead.id, body);
  return objectRecordToLeadShape(updated, lead._stages);
}

const MAX_STEPS = 25; // safety cap against malformed/cyclic graphs

// Real workflow templates label branch edges "YES"/"NO"/"MAYBE" — these
// represent a call outcome, which this engine doesn't generate itself
// (calls stay manual, see executeNode). If the lead already has a real
// call logged, its recorded intent is the best available signal for
// which branch to take; this maps that intent to the label keywords a
// human workflow author would plausibly have used.
const INTENT_TO_LABEL_KEYWORDS = {
  "Interested": ["yes"],
  "Not Interested": ["no"],
  "Callback Scheduled": ["maybe", "callback"],
  "Wrong Number": ["no"],
  "Unknown": []
};

function pickBranchEdge(outgoing, lead, latestCallIntent) {
  if (outgoing.length <= 1) return { edge: outgoing[0], confident: true };

  const byStatus = outgoing.find((e) => e.label && lead.status && e.label.toLowerCase() === lead.status.toLowerCase());
  if (byStatus) return { edge: byStatus, confident: true };

  const keywords = INTENT_TO_LABEL_KEYWORDS[latestCallIntent] || [];
  const byIntent = outgoing.find((e) => e.label && keywords.some((kw) => e.label.toLowerCase().includes(kw)));
  if (byIntent) return { edge: byIntent, confident: true };

  // No real signal to decide — take the first edge but flag the run for
  // human review rather than silently guessing.
  return { edge: outgoing[0], confident: false };
}

async function executeAction(orgId, node, lead) {
  const actionType = node.config?.actionType;
  switch (actionType) {
    case "tag_lead": {
      const tagName = node.config.tagName || "Workflow";
      const tags = Array.from(new Set([...(lead.tags || []), tagName]));
      return { message: `Tagged lead with "${tagName}".`, leadPatch: { tags } };
    }
    case "close_lead":
      // "Unqualified" matches a legacy `leads.status` value directly. For an
      // objects-backed lead, patchLead() only applies this if some stage's
      // label matches case-insensitively — LENDING_PACK's lending_lead
      // stages don't include "Unqualified" (closest is "Lost"), so today
      // this silently no-ops the stage change for objects-backed leads
      // rather than guessing. Needs a real per-pack status→stage mapping
      // before Phase 4 step 4/5 make that path reachable.
      return { message: "Lead marked Unqualified and closed.", leadPatch: { status: "Unqualified" } };
    case "schedule_callback":
      return { message: "Callback scheduled (logged only — no calendar integration yet)." };
    case "assign_agent": {
      const note = `${lead.notes ? lead.notes + "\n" : ""}[Workflow] Assigned to agent ${node.config.agentId || "unspecified"}.`;
      return { message: `Assigned to agent ${node.config.agentId || "unspecified"}.`, leadPatch: { notes: note } };
    }
    case "send_sms":
    case "send_whatsapp": {
      if (!lead.phone) return { message: "Skipped — lead has no phone number.", needsReview: true };
      const onDnc = await complianceEngine.isOnDncList(orgId, lead.phone).catch(() => false);
      if (onDnc) return { message: `Skipped — ${lead.phone} is on the Do-Not-Call list.`, needsReview: true };
      const channel = await channelsEngine.getChannel(orgId, "whatsapp");
      if (!channel) return { message: "Skipped — no WhatsApp channel connected for this org.", needsReview: true };
      try {
        const text = node.config.prompt || `Hi ${lead.name}, following up on your enquiry.`;
        await whatsapp.sendTextMessage(channel, lead.phone, text);
        return { message: `WhatsApp message sent to ${lead.phone}.` };
      } catch (err) {
        return { message: `WhatsApp send failed: ${err.message}`, needsReview: true };
      }
    }
    default:
      return { message: `No handler for action type "${actionType}".`, needsReview: true };
  }
}

async function executeNode(orgId, node, lead) {
  switch (node.type) {
    case "action":
      return executeAction(orgId, node, lead);
    case "call":
      return { message: "Call step reached — place this call manually from the dialer (not auto-dialed).", needsReview: true };
    case "question":
      return { message: "Question step reached — needs a live conversation to collect an answer.", needsReview: true };
    case "decision":
      return { message: `Branch evaluated against lead status "${lead.status}".` };
    default:
      return { message: `No handler for node type "${node.type}".`, needsReview: true };
  }
}

async function runWorkflow(orgId, workflowId, leadId) {
  const workflows = await db.list("workflows", orgId);
  const workflow = workflows.find((w) => w.id === workflowId);
  if (!workflow) {
    const err = new Error("Workflow not found");
    err.statusCode = 404;
    throw err;
  }

  let lead = await loadLead(orgId, leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.statusCode = 404;
    throw err;
  }

  const triggerNode = (workflow.nodes || []).find((n) => n.type === "trigger");
  if (!triggerNode) {
    const err = new Error("Workflow has no trigger node");
    err.statusCode = 400;
    throw err;
  }

  const callLogs = await db.list("calllogs", orgId);
  const leadCallLogs = callLogs
    .filter((c) => c.leadId === leadId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const latestCallIntent = leadCallLogs[0]?.intent || null;

  const nodesById = new Map((workflow.nodes || []).map((n) => [n.id, n]));
  const edgesBySource = new Map();
  for (const e of workflow.edges || []) {
    if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, []);
    edgesBySource.get(e.source).push(e);
  }

  const log = [{ nodeId: triggerNode.id, type: "trigger", label: triggerNode.label, result: "Workflow started", timestamp: new Date().toISOString() }];
  let status = "completed";
  let currentNodeId = triggerNode.id;
  const visited = new Set([triggerNode.id]);
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;
    const outgoing = edgesBySource.get(currentNodeId) || [];
    if (!outgoing.length) break;

    const { edge: nextEdge, confident } = pickBranchEdge(outgoing, lead, latestCallIntent);
    if (!confident) {
      log.push({ nodeId: currentNodeId, type: "branch", label: "Branch decision", result: `Multiple branches (${outgoing.map((e) => e.label).join(", ")}) and no call intent to decide by — took "${nextEdge.label || "first"}" as a default. Review manually.`, timestamp: new Date().toISOString() });
    }

    const nextNode = nodesById.get(nextEdge.target);
    if (!nextNode || visited.has(nextNode.id)) break;
    visited.add(nextNode.id);
    currentNodeId = nextNode.id;

    const result = await executeNode(orgId, nextNode, lead);
    log.push({ nodeId: nextNode.id, type: nextNode.type, label: nextNode.label, result: result.message, timestamp: new Date().toISOString() });

    if (result.leadPatch) {
      lead = await patchLead(orgId, lead, result.leadPatch);
    }
    if (result.needsReview || !confident) status = "needs_review";
  }

  return persistRun(orgId, workflowId, leadId, status, log);
}

async function persistRun(orgId, workflowId, leadId, status, log) {
  if (!db.supabase) {
    const err = new Error("Workflow run history requires the MySQL database to be configured.");
    err.statusCode = 503;
    throw err;
  }
  const { data, error } = await db.supabase
    .from("workflow_runs")
    .insert({ org_id: orgId, workflow_id: workflowId, lead_id: leadId, status, log, completed_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(`[workflowEngine.persistRun] ${error.message}`);
  return runRowToApi(data);
}

function runRowToApi(row) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    leadId: row.lead_id,
    status: row.status,
    log: row.log,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

async function listRuns(orgId, workflowId) {
  if (!db.supabase) return [];
  const { data, error } = await db.supabase
    .from("workflow_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("workflow_id", workflowId)
    .order("started_at", { ascending: false });
  if (error) throw new Error(`[workflowEngine.listRuns] ${error.message}`);
  return (data || []).map(runRowToApi);
}

module.exports = { runWorkflow, listRuns };
