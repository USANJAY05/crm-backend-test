// GCP project lifecycle service for organization-scoped Vertex AI.
// Provisioning credentials are intentionally separate from runtime Vertex AI
// credentials. The service is idempotent: the project id is deterministic and
// an existing project is reused on retries instead of creating another one.
const crypto = require("crypto");
const fs = require("fs");
const { GoogleAuth } = require("google-auth-library");
const db = require("../db/repository");
const { getLogger } = require("../observability/logger");
const log = getLogger("ai.googleCloudProjectProvisioner");

const RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com/v3";
const BILLING = "https://cloudbilling.googleapis.com/v1";
const SERVICE_USAGE = "https://serviceusage.googleapis.com/v1";
const VERTEX_SERVICE = "aiplatform.googleapis.com";
const authCache = new Map();

function getProvisionerCredentials() {
  const raw = process.env.GCP_PROJECT_PROVISIONER_CREDENTIALS_JSON;
  if (raw) {
    try { return JSON.parse(raw); }
    catch (err) { throw new Error(`Invalid GCP_PROJECT_PROVISIONER_CREDENTIALS_JSON: ${err.message}`); }
  }
  const file = process.env.GCP_PROJECT_PROVISIONER_CREDENTIALS;
  if (file && fs.existsSync(file)) return { keyFile: file };
  // Backward-compatible migration path. Do not use the runtime-specific
  // JSON variable here; a deployment can move to the new variable safely.
  const legacy = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (legacy && fs.existsSync(legacy)) return { keyFile: legacy };
  throw new Error("GCP project provisioner credentials are not configured");
}

function getAuth() {
  const key = process.env.GCP_PROJECT_PROVISIONER_CREDENTIALS_JSON || process.env.GCP_PROJECT_PROVISIONER_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || "default";
  if (authCache.has(key)) return authCache.get(key);
  const credentials = getProvisionerCredentials();
  const options = { scopes: ["https://www.googleapis.com/auth/cloud-platform"] };
  if (credentials.keyFile) options.keyFile = credentials.keyFile;
  else options.credentials = credentials;
  const instance = new GoogleAuth(options);
  authCache.set(key, instance);
  return instance;
}

async function request(url, options = {}) {
  const client = await getAuth().getClient();
  const response = await client.request({ url, ...options });
  return response.data;
}

function slugify(value) {
  return String(value || "org").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "-").replace(/-+/g, "-").slice(0, 18) || "org";
}

function makeProjectId(orgId, orgName) {
  // Stable across retries and processes. 30 chars max for GCP project ids.
  const suffix = crypto.createHash("sha256").update(String(orgId)).digest("hex").slice(0, 10);
  return `${slugify(orgName)}-${suffix}`.slice(0, 30).replace(/-+$/g, "x");
}

async function waitForOperation(operationName, base = RESOURCE_MANAGER, { timeoutMs = 120000, intervalMs = 1500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await request(`${base}/${operationName}`);
    if (data.done) {
      if (data.error) throw new Error(data.error.message || `Google Cloud operation failed: ${operationName}`);
      return data.response || data;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for Google Cloud operation ${operationName}`);
}

function getParent() {
  if (process.env.GCP_PARENT_ORGANIZATION_ID) return { type: "organization", id: process.env.GCP_PARENT_ORGANIZATION_ID };
  if (process.env.GCP_PARENT_FOLDER_ID) return { type: "folder", id: process.env.GCP_PARENT_FOLDER_ID };
  throw new Error("GCP_PARENT_ORGANIZATION_ID or GCP_PARENT_FOLDER_ID must be configured");
}

function getBillingAccountName() {
  const id = String(process.env.GCP_BILLING_ACCOUNT_ID || "").trim();
  if (!id) throw new Error("GCP_BILLING_ACCOUNT_ID must be configured");
  return id.startsWith("billingAccounts/") ? id : `billingAccounts/${id}`;
}

async function getProject(projectId) {
  try { return await request(`${RESOURCE_MANAGER}/projects/${encodeURIComponent(projectId)}`); }
  catch (err) {
    const code = err?.response?.status || err?.code;
    if (code === 404) return null;
    throw err;
  }
}

async function createOrGetProject({ orgId, orgName }) {
  const projectId = makeProjectId(orgId, orgName);
  const existing = await getProject(projectId);
  if (existing) return existing;
  const parent = getParent();
  const labels = {
    crm_org_id: String(orgId).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 63),
    managed_by: "crm",
    purpose: "vertex-ai",
  };
  try {
    const created = await request(`${RESOURCE_MANAGER}/projects`, {
      method: "POST",
      data: { projectId, displayName: `${orgName} - Vertex AI`, parent, labels }
    });
    return await waitForOperation(created.name);
  } catch (err) {
    // Another worker/process may have created the deterministic project first.
    const raced = await getProject(projectId);
    if (raced) return raced;
    throw err;
  }
}

async function linkBilling(projectId) {
  await request(`${BILLING}/projects/${encodeURIComponent(projectId)}/billingInfo`, {
    method: "PUT", data: { billingAccountName: getBillingAccountName() }
  });
}

async function enableVertex(projectId) {
  try {
    const op = await request(`${SERVICE_USAGE}/projects/${encodeURIComponent(projectId)}/services/${VERTEX_SERVICE}:enable`, { method: "POST", data: {} });
    if (op?.name) await waitForOperation(op.name, SERVICE_USAGE);
  } catch (err) {
    // Already-enabled is safe to continue; all other errors are real failures.
    const message = String(err?.message || "");
    if (!/already enabled|already exists/i.test(message)) throw err;
  }
}

async function provisionOrgProject({ orgId, orgName }) {
  if (!process.env.GCP_BILLING_ACCOUNT_ID) throw new Error("GCP multi-project provisioning is not configured: GCP_BILLING_ACCOUNT_ID is missing");
  if (!process.env.GCP_PARENT_ORGANIZATION_ID && !process.env.GCP_PARENT_FOLDER_ID) throw new Error("GCP multi-project provisioning is not configured: set GCP_PARENT_ORGANIZATION_ID or GCP_PARENT_FOLDER_ID");

  const existing = await db.getOrgCloudProject(orgId);
  if (existing?.status === "ready" && existing.project_id) return mapProject(existing);
  await db.updateOrgCloudProject(orgId, { status: "provisioning", error_code: null, error_message: null, attempt: Number(existing?.attempt || 0) + 1, organizationName: orgName });

  try {
    const project = await createOrGetProject({ orgId, orgName });
    const projectId = project.projectId || project.project?.projectId;
    if (!projectId) throw new Error("Google Cloud returned no projectId");
    await linkBilling(projectId);
    await enableVertex(projectId);
    const saved = await db.updateOrgCloudProject(orgId, {
      status: "ready", project_id: projectId, project_number: project.projectNumber || null,
      billing_account: getBillingAccountName(), location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
      provisioned_at: new Date().toISOString(), error_code: null, error_message: null
    });
    // Keep the old JSON field as a compatibility mirror for existing clients.
    await db.updateOrg(orgId, { gcpVertexProject: {
      projectId, projectNumber: project.projectNumber || null, billingAccount: getBillingAccountName(),
      location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1", status: "ready", provisionedAt: saved.provisioned_at
    }});
    log.info(`✅ Vertex AI project ${projectId} ready for organization ${orgId}`);
    return mapProject(saved);
  } catch (err) {
    await db.updateOrgCloudProject(orgId, { status: "failed", error_code: String(err?.code || "GCP_PROVISIONING_FAILED"), error_message: err.message }).catch(() => {});
    await db.updateOrg(orgId, { gcpVertexProject: { status: "failed", error: err.message, failedAt: new Date().toISOString() }}).catch(() => {});
    throw err;
  }
}

function mapProject(row) {
  return {
    projectId: row.project_id,
    projectNumber: row.project_number || null,
    location: row.location || process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
    billingAccount: row.billing_account || getBillingAccountName(),
    status: row.status,
    provisionedAt: row.provisioned_at || null,
    attempt: row.attempt || 0,
  };
}

module.exports = { provisionOrgProject, makeProjectId, getProject };
