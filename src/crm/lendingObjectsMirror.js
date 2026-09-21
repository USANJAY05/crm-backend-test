// ============================================================
// services/lendingObjectsMirror.js
//
// Phase 4 step 3 (see PHASE4_MIGRATION_PLAN.md): dual-write shim.
// Legacy `leads`/`loans` tables (services/db.js) stay the sole source of
// truth for every read in the app today — nothing here is read from yet.
// On every write to leads/loans, this mirrors the same data into
// object_records under the "lending_lead"/"lending_loan" objects
// (industryPacks.js's LENDING_PACK), IF those objects already exist for
// the org. No real org has them yet (LENDING_PACK isn't wired into
// signup), so in production this is a no-op today — every call here
// starts with a getObjectByKey check and returns immediately if the
// object doesn't exist. That's deliberate: dual-write must never be the
// thing that makes an org's lending data model change; only an explicit,
// separately-confirmed step (wiring LENDING_PACK into signup, or a
// backfill script) does that.
//
// Mirror failures are always swallowed (logged, never thrown) — the
// legacy write is authoritative and must never fail or roll back because
// of a problem in the shadow copy.
//
// Correlation: object_records has no FK column, so each mirrored record
// carries the legacy row's id as data.legacyId. Loans additionally carry
// data.leadRecordId pointing at the mirrored lead's object_records.id
// (looked up by the loan's legacy lead_id), matching the cross-reference
// approach drafted in industryPacks.js.
// ============================================================

const db = require("../db/repository");
const objectsEngine = require("./objectsEngine");
const { getLogger } = require("../observability/logger");
const log = getLogger("crm.lendingObjectsMirror");

const LEAD_OBJECT_KEY = "lending_lead";
const LOAN_OBJECT_KEY = "lending_loan";

async function safely(label, fn) {
  try {
    await fn();
  } catch (err) {
    log.error(`[lendingObjectsMirror] ${label} failed (non-fatal, legacy write already succeeded):`, err.message);
  }
}

async function findMirroredRecordId(orgId, objectKey, legacyId) {
  const records = await objectsEngine.listRecords(orgId, objectKey);
  const match = records.find((r) => r.legacyId === legacyId);
  return match ? match.id : null;
}

function leadToMirrorBody(lead) {
  return {
    legacyId: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    amountRequested: lead.amountRequested,
    score: lead.score,
    source: lead.source,
    notes: lead.notes
  };
}

function loanToMirrorBody(loan, leadRecordId) {
  return {
    legacyId: loan.id,
    leadRecordId: leadRecordId || loan.leadId || null,
    amount: loan.amount,
    interestRate: loan.interestRate,
    termMonths: loan.termMonths,
    monthlyEmi: loan.monthlyEmi,
    nextPaymentDate: loan.nextPaymentDate
  };
}

async function mirrorLeadCreate(orgId, lead) {
  await safely("mirrorLeadCreate", async () => {
    const object = await objectsEngine.getObjectByKey(orgId, LEAD_OBJECT_KEY);
    if (!object) return;
    await objectsEngine.createRecord(orgId, LEAD_OBJECT_KEY, leadToMirrorBody(lead));
  });
}

async function mirrorLeadPatch(orgId, leadId, patchedLead) {
  await safely("mirrorLeadPatch", async () => {
    const object = await objectsEngine.getObjectByKey(orgId, LEAD_OBJECT_KEY);
    if (!object) return;
    const recordId = await findMirroredRecordId(orgId, LEAD_OBJECT_KEY, leadId);
    if (!recordId) return; // nothing mirrored yet for this lead — skip rather than guess
    await objectsEngine.patchRecord(orgId, LEAD_OBJECT_KEY, recordId, leadToMirrorBody(patchedLead));
  });
}

async function mirrorLoanCreate(orgId, loan) {
  await safely("mirrorLoanCreate", async () => {
    const object = await objectsEngine.getObjectByKey(orgId, LOAN_OBJECT_KEY);
    if (!object) return;
    const leadRecordId = loan.leadId ? await findMirroredRecordId(orgId, LEAD_OBJECT_KEY, loan.leadId) : null;
    await objectsEngine.createRecord(orgId, LOAN_OBJECT_KEY, loanToMirrorBody(loan, leadRecordId));
  });
}

async function mirrorLoanPatch(orgId, loanId, patchedLoan) {
  await safely("mirrorLoanPatch", async () => {
    const object = await objectsEngine.getObjectByKey(orgId, LOAN_OBJECT_KEY);
    if (!object) return;
    const recordId = await findMirroredRecordId(orgId, LOAN_OBJECT_KEY, loanId);
    if (!recordId) return;
    const leadRecordId = patchedLoan.leadId ? await findMirroredRecordId(orgId, LEAD_OBJECT_KEY, patchedLoan.leadId) : null;
    await objectsEngine.patchRecord(orgId, LOAN_OBJECT_KEY, recordId, loanToMirrorBody(patchedLoan, leadRecordId));
  });
}

// Mirrors a full /api/leads/sync or /api/loans/sync replaceAll — only
// meaningful once the legacy replaceAll call has already succeeded.
async function mirrorReplaceAll(orgId, kind, apiArray) {
  const objectKey = kind === "leads" ? LEAD_OBJECT_KEY : LOAN_OBJECT_KEY;
  await safely(`mirrorReplaceAll:${kind}`, async () => {
    const object = await objectsEngine.getObjectByKey(orgId, objectKey);
    if (!object) return;

    const existing = await objectsEngine.listRecords(orgId, objectKey);
    for (const record of existing) {
      await objectsEngine.removeRecord(orgId, objectKey, record.id);
    }
    if (!apiArray || !apiArray.length) return;

    if (kind === "leads") {
      for (const lead of apiArray) {
        await objectsEngine.createRecord(orgId, objectKey, leadToMirrorBody(lead));
      }
    } else {
      for (const loan of apiArray) {
        const leadRecordId = loan.leadId ? await findMirroredRecordId(orgId, LEAD_OBJECT_KEY, loan.leadId) : null;
        await objectsEngine.createRecord(orgId, objectKey, loanToMirrorBody(loan, leadRecordId));
      }
    }
  });
}

module.exports = { mirrorLeadCreate, mirrorLeadPatch, mirrorLoanCreate, mirrorLoanPatch, mirrorReplaceAll };
