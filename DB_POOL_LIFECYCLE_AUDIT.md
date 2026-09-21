# MySQL Pool Lifecycle Audit

## Fixes

- The backend uses one shared `mysql2/promise` pool.
- Pool acquisition is now bounded with `MYSQL_POOL_QUEUE_LIMIT` (default `50`).
  This avoids the mysql2 default of an unbounded wait queue during DB saturation.
- `MYSQL_POOL_CONNECTION_TIMEOUT_MS` continues to bound connection establishment.
- `closePool()` is idempotent and is called by the repository shutdown path.
- The server waits for the HTTP server to close before stopping the queue and closing the DB pool.
- Pool-level errors are observed and logged through the redacting application logger; query errors remain propagated to callers.
- Transactions acquire one dedicated connection and always release it in `finally` after commit/rollback attempts.

## Operational recommendation

Tune `MYSQL_POOL_MAX` and `MYSQL_POOL_QUEUE_LIMIT` from load-test results. A queue limit is a back-pressure mechanism, not a substitute for database capacity planning.

The actual MySQL 8.4 load/concurrency test must still be run in an environment with Docker/MySQL available.
