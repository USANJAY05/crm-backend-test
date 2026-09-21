# Gemini Live usage & cost tracking

This document explains the usage/cost tracking layer added around the
existing Vertex AI / Gemini Live integration. It does not replace or
rewrite that integration — it observes it.

## What's stored, and why

Every Gemini Live session (one WebSocket connection to
`genai.live.connect(...)`) gets one row in `ai_session_usage`:

- **Who**: `org_id`, `admin_id` (the authenticated human account, when one
  exists — see "adminId is sometimes null" below).
- **What call**: `call_id` (this app's own internal call id — the same id
  `call_logs.id` uses) and `session_id` (the provider's own
  session/stream id where one exists — see "Session ID" below).
- **Where it ran**: `gcp_project_id`, `gcp_location`, `provider` (vobiz /
  twilio / piopiy / gemini-dev), `model`.
- **When**: `session_started_at`, `session_ended_at`, `duration_seconds`.
- **How much**: `input_tokens`, `output_tokens`, `total_tokens`,
  `input_cost`, `output_cost`, `total_cost`, `currency`,
  `pricing_version`.
- **Outcome**: `status` (`in_progress` / `completed` / `failed`),
  `error_code`, `error_message`.
- **Extensibility**: `metadata` (jsonb) — anywhere the SDK returns a
  usage field this table has no dedicated column for yet, it goes here
  instead of being discarded.
- **Reserved, unused today**: `actual_billed_cost`, `billing_export_id`,
  `billing_period`, `reconciliation_status`, `reconciled_at` — see
  "Future: Google Cloud Billing reconciliation" below.

**Deliberately NOT stored**: transcripts, recording URLs, or audio. This
table exists purely for usage/cost accounting; call content already has
its own home in `call_logs` with its own access rules.

## How token usage is captured

`src/ai/googleAiClient.js`'s existing Gemini Live connection
(`genai.live.connect(...)` inside `openGeminiSession()` in
`src/telephony/vobizProxy.js`) already had a raw WebSocket packet
listener that inspects every server frame for a `usageMetadata` field
(added independently of this work, for the existing per-call cost log
line). This tracking layer hooks the SAME event, one line lower — it does
not add a second listener or a second connection.

Two independent things happen with each `usageMetadata` event:

1. The **existing** `onTokenUsage(inCount, outCount)` callback still runs
   unchanged — this feeds the pre-existing per-call cost logging
   (`📊 Cost Breakdown: ...`) that was already in production. Not touched.
2. The **new** `geminiUsageTracker.recordUsage(handle, { inputTokens,
   outputTokens })` call runs alongside it, writing to `ai_session_usage`.

### Cumulative vs. incremental usage — and why this matters

The Gemini Live API reports `usageMetadata.promptTokenCount` /
`candidatesTokenCount` as the **running total for the session so far**,
not a per-event delta. `recordUsage()` is written for that: it keeps only
the **maximum** value seen across all events for a session (never sums),
so:

- Receiving the same cumulative value twice is a no-op.
- Receiving an out-of-order or stale event with a *lower* value than
  already stored does not regress the stored count.
- The final value stored, whenever the session ends, is already the
  correct total — no separate "sum it all up at the end" step needed.

This is intentionally a different (and, for a dedicated usage-accounting
table, more correct) strategy than the pre-existing `onTokenUsage`
callback's own behavior, which sums every raw event it receives without
that guard. That existing behavior was not changed as part of this work
— changing it risks altering numbers already relied on in production
logs — but it's worth knowing the two code paths can diverge slightly if
Gemini ever sends more than one `usageMetadata` frame with a non-monotonic
value in a single call.

If a session ends with no `usageMetadata` ever having arrived,
`input_tokens`/`output_tokens` stay `0` rather than being estimated from
audio duration or invented — the row still gets created and finalized
(so "usage was unavailable for this session" is itself visible in the
data, not a missing row that looks like it never happened).

## How cost is calculated

`src/ai/geminiCostCalculator.js` is the **only** place a token count
becomes a dollar figure. Pricing itself lives in a separate file,
`src/ai/geminiPricing.js` (`$ / 1,000,000 tokens`, per model) — updating
Google's prices means editing that one file, not any session-management
code.

Every cost calculation is stamped with:

- `currency` (`"USD"`)
- `pricing_version` — a string bumped whenever `geminiPricing.js`
  changes, so a historical row keeps reading correctly under the pricing
  that was actually active when it was calculated, even after prices
  change later.
- `estimated: true` on the calculator's return value, and every API
  response this data flows into.

### Why the estimated cost can differ from your Google Cloud invoice

This is an **application-level estimate**, not Google's authoritative
billed amount, for reasons including:

- Google Cloud Billing may apply discounts, committed-use pricing, free
  tier allowances, or promotional pricing this calculator has no
  visibility into.
- The Gemini Live API's `usageMetadata` token counts are what the SDK
  reports at the protocol level; Google's actual billing meter for a
  given API/SKU combination is not guaranteed to be identical unit-for-unit.
- Non-token charges (if any apply to a given model/API combination) are
  not reflected here at all — only input/output token pricing is modeled.
- If a session's `usageMetadata` never arrived (see above), that
  session's estimated cost is `0`, understating actual usage for that
  one session.

**Never present `total_cost` from this table as an invoice figure.** It
exists to let ChiefVoice answer "roughly what did this call cost us"
across calls/orgs/admins quickly, from data the app already has —
Google Cloud Billing remains the source of truth for actual billed
amounts.

## How duplicate usage / double finalization is prevented

- **Idempotent by construction, not by a uniqueness constraint alone.**
  `startUsageSession()` creates exactly one row and returns its `id`;
  every subsequent call (`recordUsage`, `finalizeUsageSession`,
  `failUsageSession`) operates on that specific row by id — none of them
  ever create a second row for the same session.
- **`finalizeUsageSession()`/`failUsageSession()` are no-ops once a
  session is no longer `in_progress`.** If both a normal close handler
  and an error handler somehow fire for the same session, only the first
  actually writes — the second sees `status !== 'in_progress'` and
  returns the already-finalized row unchanged. A session that finished
  `completed` can never be silently flipped to `failed` by a late error
  handler.
- **`recordUsage()` after finalization is also a no-op** — a stray
  `usageMetadata` event arriving after the session already closed does
  not reopen or mutate a finalized record.

## Google Cloud project resolution — the provider abstraction

```
Admin
  │
  ▼
getGoogleCloudProjectProvider()   (src/ai/googleCloudProjectProvider.js)
  │
  ▼
SharedGoogleCloudProjectProvider  ← the only one wired up today
  │
  ▼
One GCP project (GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION env vars —
the SAME env vars src/ai/googleAiClient.js already used before this work;
no new configuration was introduced)
```

`openGeminiSession()` (and any future call site) asks
`getGoogleCloudProjectProvider().resolveProject({ orgId, adminId })` for
`{ projectId, location, source }` — it does not read `process.env`
directly, and it contains no `if (admin has own project) ... else ...`
branching. That decision is entirely inside whichever provider is active.

### Adding per-admin GCP projects later

1. Implement `PerAdminGoogleCloudProjectProvider.resolveProject({ orgId,
   adminId })` (the class already exists in
   `googleCloudProjectProvider.js` as a documented stub that throws if
   used) — it should look up that admin's own project/location from an
   admin or org record (a new DB column, e.g. `org_agents`-style table or
   a dedicated `admin_gcp_projects` table — not designed yet, deliberately,
   per the current scope) instead of `process.env`.
2. Swap the one line inside `getGoogleCloudProjectProvider()` that
   constructs `new SharedGoogleCloudProjectProvider()` for
   `new PerAdminGoogleCloudProjectProvider()` (or a hybrid provider that
   checks for a per-admin project and falls back to shared — that
   fallback logic belongs INSIDE a provider implementation, never
   scattered through calling code).
3. **Nothing in `vobizProxy.js`/`twilioProxy.js`/`piopiyProxy.js`/
   `geminiProxy.js` needs to change.** They already call the abstraction,
   not `process.env`, not a shared-vs-per-admin conditional.
4. `ai_session_usage.gcp_project_id` already varies per row (it's
   whatever `resolveProject()` returned at session-start time for THAT
   session) — reporting queries already work correctly whether every row
   has the same project (today) or different ones per admin (later). No
   schema change needed for this part.
5. Additional configuration needed at that point: however the per-admin
   provider resolves a project (e.g. new columns on an admin/org table
   holding that admin's `projectId`/`location`, and — separately, and out
   of scope for the provider itself — how that admin's own GCP
   credentials get supplied to the Vertex AI client, since
   `googleAiClient.js`'s single shared `GoogleGenAI` client would also
   need to become per-project at that point). **Per-admin GCP projects
   and credentials are explicitly NOT implemented as part of this work.**

## Future: Google Cloud Billing reconciliation

Not implemented. The reserved columns
(`actual_billed_cost`/`billing_export_id`/`billing_period`/
`reconciliation_status`/`reconciled_at`) exist so that a future
reconciliation job can, without a schema migration:

1. Pull a Google Cloud Billing export for a given `gcp_project_id` +
   `model` + `billing_period`.
2. Match it against the corresponding `ai_session_usage` rows for that
   project/model/period.
3. Write the actual billed figure into `actual_billed_cost` on those
   rows, and mark `reconciliation_status`/`reconciled_at`.

This app does **not** attempt to make Google Cloud Billing labels the
source of truth for individual sessions — Gemini Live sessions are not
guaranteed to support per-session billing labels in the currently-used
SDK/API version, and this design does not depend on them.

## Limitations of the current Gemini Live SDK regarding usage/billing

- `usageMetadata` in the Live API's server messages is the ONLY usage
  signal available from the SDK (`@google/genai` `^2.15.0`, the version
  already pinned in `package.json` before this work) — there is no
  separate "final usage summary" event at session end; the last
  `usageMetadata` received during the session IS the final total.
- If Gemini Live changes to report deltas instead of cumulative totals in
  a future SDK version, `recordUsage()`'s "keep the maximum" strategy
  would need to change to "sum every event" instead — this is called out
  explicitly in `geminiUsageTracker.js`'s own comments as the one
  assumption to re-verify against SDK release notes if usage numbers ever
  look implausibly low after an SDK upgrade.
- Billing labels: not used by this design at all (see above), so no
  assumption is made about whether the currently-used SDK/API version
  supports attaching custom labels to a Live session's billing records —
  this was not verified against current Google documentation and this
  design deliberately does not depend on the answer either way.
- No SDK-native "session id" is exposed at `genai.live.connect()` time —
  `session_id` in `ai_session_usage` is populated with Vobiz's own stream
  id (an existing identifier already unique per connection attempt) as a
  practical substitute, per the requirement to use existing identifiers
  rather than invent a duplicate one.

## Where this is (and isn't) wired up yet

Fully integrated into `src/telephony/vobizProxy.js`, `twilioProxy.js`,
and `piopiyProxy.js` — the three production telephony providers, each at
the identical three points in their `openGeminiSession()`:
`startUsageSession()` right before `genai.live.connect()`,
`recordUsage()` on every `usageMetadata` event from the raw WebSocket
packet listener, and `finalizeUsageSession()`/`failUsageSession()` in the
Gemini session's `onclose` handler (code `1000` = normal close =
`completed`; anything else = `failed`, with the close code/reason
recorded).

**Not wired into** `geminiProxy.js` — the separate `/session` browser
dev-testing path (no telephony provider, runs under a fixed `DEV_ORG_ID`
with no real per-org/per-admin context). Its `openGeminiSession()` doesn't
even take a `callId` parameter today; wiring it in would need that added
first. Left out of scope since it isn't a real customer-facing call path.

## API

- `GET /api/ai-usage` — paginated list of the authenticated org's usage
  sessions (`?page=&limit=`).
- `GET /api/ai-usage/summary` — aggregate totals (sessions, calls,
  tokens, estimated cost) for the org, optionally bounded by `?from=&to=`
  (ISO dates).
- `GET /api/ai-usage/by-admin` — the same aggregate broken down per
  `admin_id`.

All three are `requireAuth`-gated and scoped by `req.orgId` from the
authenticated session — never a client-supplied org/admin id — so one
org can never see another's usage. No frontend UI was built against this
yet, per scope (backend tracking first).
