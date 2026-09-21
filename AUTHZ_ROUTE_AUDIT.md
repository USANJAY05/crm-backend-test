# Authorization Route Audit — Fix #15

## Changes

- Legacy `/api/metrics` now requires an organization-admin role. It reads global/demo flat-file data and is not a tenant-scoped CRM endpoint; ordinary organization members must not access it.
- `/api/list-models` now requires an organization-admin role because it exposes platform AI model capabilities/configuration rather than tenant data.
- `/api/v2/chroma/search` now requires authentication so vector-search access always has an authenticated organization context.
- Platform routes remain protected by the router-level `requireAuthIdentityOnly + requirePlatformAdmin` middleware.
- Organization CRUD routes continue to pass `req.orgId` to repository/engine operations; client-supplied organization IDs are not used for customer routes.
- Telephony webhook routes remain separately protected by provider/webhook authentication and resolve organization from provider-controlled identifiers.

## Remaining design note

The legacy `/api/metrics` endpoint should eventually be removed in favor of `/api/dashboard/metrics`, which is explicitly organization-scoped. The role restriction is the safe interim control.
