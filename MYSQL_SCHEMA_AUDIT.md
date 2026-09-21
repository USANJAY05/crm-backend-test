# MySQL 8.4 Schema Audit

## Fix #10

The MySQL adapter now performs a schema normalization pass for every declared
column, not only newly-added columns or VARCHAR fields. Existing databases are
therefore upgraded to the current declared MySQL types; invalid JSON,
truncation, duplicate-key conflicts, or other conversion failures stop startup.

The schema also creates targeted indexes for the application's common tenant,
retry, auto-dial, call, conversation, knowledge-base, workflow, and audit-log
queries. Index creation remains idempotent and unexpected DDL errors are fatal.

### Entity coverage

The adapter declares all application tables currently used by the repository:
organizations, organization_cloud_projects, org_members, leads,
contact_groups, workflows, campaigns, loans, call_logs, dialer_tasks,
inbound_call_logs, virtual_numbers, org_agents, org_cost_archive,
question_flows, calls, lead_responses, enquiries, customers, catalog_items,
orders, questionnaires, objects, object_fields, object_stages, object_records,
channels, conversations, messages, workflow_runs, dnc_entries,
knowledge_documents, knowledge_chunks, audit_log, users, platform_settings,
and ai_session_usage.

### Runtime requirement

A real MySQL 8.4 integration run is still required before production rollout.
The repository contains `tests/mysqlIntegration.test.js` and
`docker-compose.mysql-test.yml` for that validation; this environment did not
have Docker/MySQL available to execute the container-backed test.
