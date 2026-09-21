# Phase 4 — Migrate lending onto the generic objects engine

> Drafted 2026-08-04. **Plan only — no migration code has been written yet.**
> Do not run any step against real data without a fresh explicit go-ahead per
> step, per the caution flagged in SESSION_NOTES.md §12/§13 (this is the same
> class of risk as the org_members.user_id incident: a destructive
> delete/rewrite touching every org's core records).

## 0. Why this is the risky phase

Phases 1–3 made everything *around* lending adapt to industry (sidebar,
dashboard, questionnaires) without touching lending's actual data model.
Phase 4 changes the data model itself: `leads` and `loans` tables become an
`objects`/`object_fields`/`object_stages`/`object_records` pack like every
other industry, and the old hardcoded tables/routes/UI eventually retire.

Two things make this materially riskier than phases 1–3:

- It requires a **one-time data migration** of every existing lending org's
  real `leads`/`loans` rows into `object_records`. Get the mapping wrong and
  it's silent data loss or corruption across every lending customer at once
  — not a per-org, reversible mistake.
- `workflowEngine.js` (`runWorkflow`, node actions `tag_lead`/`close_lead`/
  assignment) is hard-coded against `db.list("leads", orgId)` /
  `db.patch("leads", ...)` and lead-shaped fields (`status`, `tags`, `notes`).
  This is the deepest, least-obvious coupling point — a naive migration that
  moves data but doesn't touch this file will silently stop running
  workflows for every migrated org.

## 1. Target shape

Add a `lending` entry to `industryPacks.js` (currently explicitly excluded —
`industryPacks.js:6-8` says "lending isn't a pack here"), following the same
`{key, label, icon, fields[], stages[], hasPipeline}` shape every other pack
uses. Two objects, mirroring current tables:

- **`leads`** object — fields: `name, phone, email, amount_requested, score,
  source, notes, financial_info`. Stages from current `leads.status` values.
- **`loans`** object — fields: `amount, interest_rate, term_months,
  monthly_emi, paid_emi_count, total_emi_count, next_payment_date,
  documents, history`, plus a reference field pointing at the originating
  lead record (`object_records` has no native FK column — needs either a
  `lead_record_id` key inside the `data` JSON, or a small schema addition;
  decide before writing migration code, not during).

`listIndustries()` (`industryPacks.js:167-181`) currently hardcodes
`lending` as a special non-pack entry — this needs to fold into the same
list-from-`PACKS` path once the pack exists, without changing the
industry *key* orgs already have stored (`orgSettings.industry === 'lending'`
must keep working unchanged).

## 2. Sequencing (each step gets its own confirmation before starting)

1. **Define the lending pack** (`industryPacks.js`) — no data migration yet,
   additive only. Verify `objectsEngine.createObject` can create it cleanly
   for a fresh test org, same smoke-test style as the phase 1-3 healthcare
   test in SESSION_NOTES.md §12.
2. **Generalize `workflowEngine.js`** to operate on `object_records` +
   `object_fields`/`object_stages` generically (or, if that's too large a
   change to do safely in one pass, special-case it to also work against the
   new lending object shape) — and add a regression test/smoke test that
   exercises `tag_lead`/`close_lead`/assignment against the new shape before
   any real workflow depends on it.
3. **Dual-write shim** — for a transition window, `db.js`'s `leads`/`loans`
   functions write to *both* the old tables and the new `object_records`
   rows for lending orgs, so old and new UI paths both see consistent data
   while the frontend migrates. This avoids a hard cutover moment.
4. **One-time backfill migration** for existing lending orgs' historical
   rows — write as an explicit, idempotent, dry-runnable script (report
   counts/diffs without writing, then require a second explicit flag to
   actually write), not an inline server-boot migration. Take a full backup
   of `leads`/`loans`/`loans.history` before running for real.
5. **Frontend cutover** — migrate `LeadManagementView.tsx`,
   `LoanLifecycleView.tsx`, `DialerSimulator.tsx` (largest surface — 2585
   lines, deep read/write of `leadsDatabase`), `CampaignView.tsx` to read
   from the generic objects API instead of `/api/leads`/`/api/loans`.
   `Sidebar.tsx` and `DashboardView.tsx` already branch cleanly on
   `isLending` (built in phases 1-3) and are the template for how the other
   views should look post-migration.
6. **Retire old tables/routes** — only after the dual-write window has run
   with zero discrepancies for a full billing/verification cycle the user
   is comfortable with. Drop `GET/POST/PATCH/DELETE /api/leads`,
   `/api/loans`, `/api/leads/sync`, `/api/loans/sync` (`server.js:1699-1766,
   2022-2034`) and the old `leads`/`loans` tables last, not first.

## 3. Rollback

Because step 3 is dual-write, rollback for steps 1-4 is just "stop reading
from `object_records` in the frontend" — the old tables stay authoritative
and untouched until step 6. Step 6 (dropping old tables) is the only
irreversible step and should not happen until the user explicitly signs off
separately from the rest of this plan.

## 4. Open questions for the user before step 1 starts

- Confirm the `loans → lead` cross-reference approach (JSON key inside
  `data` vs. a schema addition) — affects both objectsEngine and every
  frontend read site.
- Confirm whether dual-write (step 3) is acceptable as a transition
  mechanism, or whether a hard cutover is preferred despite the higher risk.
- Real production `leads`/`loans` row counts are unknown from this dev
  environment (local dev DB currently has 0 rows of either) — need real
  counts from the user's Supabase/production data before sizing the backfill
  script's risk and runtime.
