# MySQL Referential Integrity Audit

## Tenant boundary

Every application table containing `org_id` now has a database foreign key to `organizations.id`, except `org_cost_archive` by design. The archive is historical data and must survive organization deletion.

The migration checks for orphaned `org_id` values before creating each foreign key. Existing orphan rows cause startup to fail with the table and count so they can be repaired explicitly.

Foreign keys use:

- `ON UPDATE CASCADE`
- `ON DELETE CASCADE`

This complements the application-level organization deletion transaction and prevents future tenant rows from surviving after their organization is removed.

## Intentionally not enforced automatically

Several entity IDs are polymorphic or historically ambiguous in the application (`call_id` can refer to different call tables, for example). Those relationships are not converted into foreign keys without first proving the exact parent table and lifecycle semantics. A wrong FK would be more dangerous than leaving an application-level reference.

## Validation

Run the MySQL integration suite against MySQL 8.4 after dependencies are installed:

```bash
npm run test:mysql
```

The suite should also verify that deleting an organization removes tenant rows through the FK cascade and that orphan tenant rows prevent schema initialization.
