# JSON Data Audit — MySQL 8.4

- Application JSON/array fields use native MySQL `JSON` columns.
- JSON values are serialized at the DB adapter boundary and parsed on reads.
- Array-typed fields reject non-array writes.
- Malformed JSON returned from a JSON column is treated as a data-integrity error rather than silently returned as a string.
- `dialer_tasks.call_results` uses a lead ID as a JSON object key; `claimAutoDialLead` now requires the application's UUID format before that value is used in a JSON path.
- Feature-flag backfill uses native `JSON_ARRAY_APPEND`/`JSON_CONTAINS`.
- JSON columns are not indexed blindly; generated/functional indexes should be added only for measured hot paths.
- Live MySQL 8.4 integration tests still need to run where Docker/MySQL is available.
