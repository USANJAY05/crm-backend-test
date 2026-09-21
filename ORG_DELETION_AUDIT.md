# Organization deletion audit

## Fixed

Final billing archive creation and tenant deletion now occur in the same MySQL transaction. A failure rolls back both operations.

The cost archive has a unique index on `org_id`, making the final snapshot idempotent for a given organization ID.

Deletion now aborts when the organization does not exist instead of treating a missing billing snapshot as a successful deletion.

The archive table is excluded from tenant cascades/deletion and therefore survives organization deletion.

The post-commit audit event is emitted only after the transaction succeeds.

## Verification

- `node --check` passes for modified files.
- Live MySQL 8.4 transaction testing still requires Docker/MySQL in the execution environment.
