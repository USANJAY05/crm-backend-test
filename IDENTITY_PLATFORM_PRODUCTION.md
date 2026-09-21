# Google Cloud Identity Platform — Production Authentication

## Environment split

- **Development:** `AUTH_PROVIDER=keycloak` and the local Keycloak Docker overlays.
- **Production:** `AUTH_PROVIDER=identity_platform`; no Keycloak container or Keycloak database is required.

Identity Platform is the end-user identity provider. The frontend performs the
Google/Identity Platform sign-in and sends the resulting ID token to the API.
The API verifies the token with the Firebase Admin SDK.

## Backend configuration

Required:

```env
AUTH_PROVIDER=identity_platform
IDENTITY_PLATFORM_PROJECT_ID=<identity-platform-project>
```

On the production VM, prefer Application Default Credentials. If explicit
credentials are required, use `IDENTITY_PLATFORM_CREDENTIALS_JSON` with a
least-privileged dedicated service account.

Do **not** use an organization/customer Vertex service-account credential for
Identity Platform verification.

## Authorization

Identity Platform proves the user's identity. The CRM MySQL `org_members`
record remains the source of truth for organization membership and application
roles. On first successful login, an email-only membership can be atomically
linked to the Identity Platform `uid`.

Platform-admin access can use the existing `PLATFORM_ADMIN_EMAILS` allowlist.
Identity Platform custom claims such as `platformAdmin: true` are also accepted
for platform-level access.

## User invitations

Production does not generate temporary passwords. A team member is added to
CRM first; the user signs in through the configured Identity Platform provider,
and the backend links the verified Identity Platform UID to the membership.
