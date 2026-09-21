# Authentication & organization-membership audit

## Fixes

- `org_members.user_id` is unique when populated, preventing one auth subject from belonging to multiple customer organizations.
- Existing duplicate non-null `user_id` values are detected during schema initialization and fail startup with the affected IDs/counts.
- Email-only legacy membership linking now uses an atomic `user_id IS NULL` predicate.
- After a concurrent link race, the code re-reads by immutable auth subject (`user_id`) rather than trusting the original email row.
- If a unique-user collision occurs, the middleware uses the already-linked membership and never falls back across organizations.
- Platform organization-creation duplicate handling recognizes MySQL `ER_DUP_ENTRY` as well as the legacy PostgreSQL code.

## Security invariant

For a normal customer login, the organization context is derived from the verified identity provider `sub` and the application's `org_members.user_id` mapping. Email is only a one-time migration/linking fallback for legacy rows with no `user_id`.

Platform-admin routes remain separate: they use identity-only authentication followed by the explicit platform-admin check and do not derive customer-org access from membership.
