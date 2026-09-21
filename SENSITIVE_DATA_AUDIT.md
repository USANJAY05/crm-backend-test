# Sensitive Data Exposure Audit

## Fix #16

Audited API serialization for provider credentials, GCP service-account credentials, local password hashes, and authentication tokens.

### Fixed

- `organization_cloud_projects.credentials_encrypted` is no longer returned by normal cloud-project reads, updates, status lists, or organization-creation responses.
- `getCloudProjectWithCredentials()` remains an explicit internal-only accessor for runtime GCP execution.
- Channel APIs continue returning masked channel configuration; encrypted credentials are only hydrated for internal provider execution.
- Local `users.password_hash` is not part of organization/member API serialization.
- Access/refresh tokens are not returned by channel APIs.

### Rule

Any code path that needs encrypted GCP/provider credentials must use an explicitly named internal accessor. Public/admin API responses must use the corresponding safe serializer.
