# Organization-scoped GCP projects

Each CRM organization gets one dedicated GCP project for Vertex AI while all
projects can remain attached to the platform's single Cloud Billing account.

## Lifecycle

1. CRM organization is created.
2. `organization_cloud_projects` gets a `pending` row.
3. `gcp-project-provisioning` is queued asynchronously.
4. Worker moves the row to `provisioning` and deterministically creates/reuses
   the project's stable ID.
5. Billing is attached and `aiplatform.googleapis.com` is enabled.
6. Row becomes `ready`; the legacy `organizations.settings.gcpVertexProject`
   field is updated as a compatibility mirror.
7. AI calls resolve the project through `googleCloudProjectProvider`.

States: `pending`, `provisioning`, `ready`, `failed`, `retained`.

## Credentials

Automatic provisioning uses the platform identity configured by
`GCP_PROJECT_PROVISIONER_CREDENTIALS_JSON` (or its file equivalent) for project
creation, billing association, and Service Usage. Do not grant that identity
unnecessary access.

Existing-project organizations supply a service-account JSON during platform
admin organization creation. The backend validates the credentials against the
specified project, verifies/enables `aiplatform.googleapis.com`, and stores the
credential JSON encrypted at rest in `organization_cloud_projects`. The
plaintext credential is never returned by an API or written to logs.

Set `GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY` to a dedicated 32-byte key (64 hex
characters or base64) in every backend instance. Keep this key in the deployment
secret manager and do not commit it to source control. Runtime Vertex clients
for manually configured organizations decrypt the credential only in memory.

The frontend keeps the JSON only in the create form state and sends it over the
authenticated HTTPS API; it does not persist it in localStorage/sessionStorage.

## Retry/idempotency

The project id is derived from the organization id and name slug, so retries
reuse the same project. The worker and HTTP retry endpoint are asynchronous.

The current queue adapter is in-process memory. For multi-instance production
workers, switch `QUEUE_PROVIDER` to a durable adapter before relying on queue
survival across restarts.

## Retention policy

Deleting a CRM organization does **not** delete its GCP project. Its
`organization_cloud_projects` row is marked `retained` before CRM deletion so
billing/audit attribution is preserved. A future explicit platform action can
handle GCP project deletion after the required retention period.
