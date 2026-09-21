# MySQL concurrency audit

## Fixed invariants

- Auto-dial lead claiming is a database compare-and-set: `current_lead_id IS NULL` and `auto_dial_enabled = true` are checked in the same `UPDATE` that writes the claim.
- The claimed lead must belong to the same organization as the dialer task.
- A scheduler worker proceeds only when the claim update affects exactly one row. It never treats an already-claimed task as its own after a follow-up `SELECT`.
- Retry claiming is also compare-and-set: only `retry_status = 'pending'` may transition to `retrying`, and only the worker that changes one row proceeds.
- Transaction connections now use the same normalized MySQL query wrapper as the shared pool, including `release()`.

## Validation

`node --check` passes for the changed database files.

The integration/concurrency tests require installed npm dependencies and a real MySQL 8.4 instance. They could not be executed in the current build environment because `mysql2`/Docker are not installed there.
