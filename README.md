# ChiefVoice CRM — Backend

Express API for ChiefVoice CRM: voice-call pipeline (Twilio/Vobiz/Gemini
Live), CRM data, workflows, omnichannel messaging, and the platform admin
API. This is a standalone project — `chiefvoice-crm-frontend` is a
separately deployed static app that talks to this over HTTP (CORS-enabled).

## Data storage

- **App data** (organizations, leads, workflows, call logs, custom objects,
  auth, etc.) lives in a self-hosted MySQL database, via
  `src/db/adapters/mysql.js`. Set `MYSQL_URL` in `.env`.
- **Call recordings are stored in the configured S3-compatible object storage. In production this is AWS S3; development may use OCI Object Storage.

## Local development

```
npm install
cp .env.example .env   # fill in your own keys
npm start               # or: npm run dev (nodemon)
```

Runs on `http://localhost:3000`.

## Environment variables

See `.env.example` for the full list (Gemini, Twilio/Vobiz, S3-compatible storage
keys, `PLATFORM_ADMIN_EMAILS`, `LOCAL_AUTH_SECRET`).

## Organization-scoped Vertex AI

New organizations receive a first-class `organization_cloud_projects` record
and an asynchronous GCP project provisioning job. See `docs/gcp-multi-project.md`.
Use separate `GCP_RUNTIME_CREDENTIALS_*` and `GCP_PROJECT_PROVISIONER_CREDENTIALS_*`
credentials. CRM organization deletion retains the GCP project for billing and
audit attribution; it is not automatically deleted.

## Single-VM production deployment

Development uses the local AWS Cognito stack. Production uses AWS Cognito for end-user authentication; see `IDENTITY_PLATFORM_PRODUCTION.md`.

The production Compose stack runs Express, MySQL, Redis, ChromaDB and Caddy on the VM. AWS Cognito is external and S3 remains external.
