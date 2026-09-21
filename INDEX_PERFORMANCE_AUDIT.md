# MySQL Index & Query Performance Audit

## Fix #20

Added composite indexes for the application's highest-frequency tenant-scoped and queue/pagination queries:

- call logs: tenant + retry/status/due-time and tenant + created time
- dialer tasks: tenant + auto-dial + next-dial time
- inbound calls: tenant + created time
- calls: tenant + created time
- lead responses: tenant + call + created time
- enquiries: tenant + status + created time
- workflows/object metadata: tenant + parent + position/status
- workflow runs: tenant + status + created time
- knowledge documents: tenant + created time
- DNC entries: tenant + phone
- object records: tenant + object + stage + created time
- existing conversation/message/audit/AI-usage indexes retained

## Important query-shape findings

Several phone/history helpers still normalize phone numbers in application code or SQL functions. Examples include suffix/last-10-digit matching and history scans. Ordinary B-tree indexes cannot efficiently accelerate an expression such as `REGEXP_REPLACE(phone, ...)` or `RIGHT(...)` without a normalized/generated column.

Those helpers were intentionally not changed in this fix because adding a normalized phone column requires a coordinated write-path migration and backfill. The current implementation remains functionally correct; this is a separate optimization candidate.

Similarly, offset pagination (`LIMIT ... OFFSET ...`) becomes increasingly expensive for very large call/audit datasets. Cursor/keyset pagination should be introduced when those datasets reach that scale rather than changing API semantics during the database migration.

## Migration behavior

Indexes are created idempotently. Existing indexes are never dropped automatically, because dropping an index can change query plans for deployments with application-specific queries. Duplicate/redundant indexes should be reviewed with `SHOW INDEX FROM <table>` and removed deliberately after production query-plan verification.
