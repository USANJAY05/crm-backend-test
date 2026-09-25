// Organization-aware Google GenAI client factory.
//
// Runtime Vertex credentials are intentionally separate from GCP project
// provisioner credentials. Organization-scoped callers MUST use
// genai.getClientForOrg(orgId). There is deliberately no shared GCP project
// fallback for an organization request.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { getLogger } = require("../observability/logger");
const { getGoogleCloudProjectProvider } = require("./googleCloudProjectProvider");
const db = require("../db/repository");
const { decryptJson } = require("../security/encryptedSecret");
const log = getLogger("ai.googleAiClient");

function prepareRuntimeCredentials() {
  const json = process.env.GCP_RUNTIME_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const file = process.env.GCP_RUNTIME_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (json && !file) {
    try {
      const credPath = path.join(os.tmpdir(), `chiefvoice-gcp-runtime-${process.pid}.json`);
      fs.writeFileSync(credPath, json, { encoding: "utf8", mode: 0o600 });
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
    } catch (err) {
      log.error("❌ Failed to prepare runtime GCP credentials:", err.message);
    }
  } else if (file) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  }
}
prepareRuntimeCredentials();

const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
const hasRuntimeCredentials = !!(
  process.env.GCP_RUNTIME_CREDENTIALS_JSON ||
  process.env.GCP_RUNTIME_CREDENTIALS ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
);

// isVertex describes the deployment capability, not a shared project.
// A deployment can be Vertex-capable while every actual Vertex client is
// created with the organization's project and credentials.
const isVertex = hasRuntimeCredentials || process.env.GCP_MULTI_PROJECT_ENABLED === "true";
const studioApiKey = process.env.GEMINI_API_KEY || "";

// This object is retained as the module's compatibility facade. In Vertex mode
// it is NOT initialized with GOOGLE_CLOUD_PROJECT and is never used for
// organization-scoped calls. Studio mode may use its API key for explicitly
// non-tenant tooling.
const genai = isVertex ? {} : new GoogleGenAI({ apiKey: studioApiKey });

const vertexClients = new Map();

function fingerprintCredentials(credentials) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(credentials || {}))
    .digest("hex")
    .slice(0, 24);
}

function validateRuntimeCredentials(credentials, orgId) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new Error(`Organization ${orgId} has no valid Google Cloud runtime credentials configured.`);
  }
  if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key) {
    throw new Error(`Organization ${orgId} has invalid Google Cloud runtime credentials.`);
  }
}

function getVertexClient(projectId, locationName = location, credentials = null) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new Error("A Google Cloud project ID is required for Vertex AI.");
  }
  if (!credentials) {
    throw new Error("Organization-specific Google Cloud runtime credentials are required for Vertex AI.");
  }

  const credentialKey = fingerprintCredentials(credentials);
  const key = `${normalizedProjectId}:${locationName}:${credentialKey}`;
  let client = vertexClients.get(key);
  if (!client) {
    const options = {
      vertexai: true,
      project: normalizedProjectId,
      location: locationName,
      googleAuthOptions: {
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      },
    };
    client = new GoogleGenAI(options);
    client.isVertex = true;
    client.projectId = normalizedProjectId;
    client.location = locationName;
    client.runtimeCredentials = credentials;
    client.runtimeCredentialFingerprint = credentialKey;
    vertexClients.set(key, client);
  }
  return client;
}

async function getClientForOrg(orgId) {
  const normalizedOrgId = String(orgId || "").trim();
  if (!normalizedOrgId) {
    throw new Error("Organization context is required for Vertex AI.");
  }

  const context = await getGoogleCloudProjectProvider().resolveProject({ orgId: normalizedOrgId });
  const row = await db.getOrgCloudProjectWithCredentials(normalizedOrgId);

  // The project selected by the resolver and the credential-bearing DB row must
  // refer to the same organization/project. Never silently combine a project
  // from one source with credentials from another source.
  if (!row?.project_id || row.project_id !== context.projectId) {
    throw new Error(`Organization ${normalizedOrgId} has incomplete Google Cloud project configuration.`);
  }
  if (!row.credentials_encrypted) {
    throw new Error(`Organization ${normalizedOrgId} has no encrypted Google Cloud runtime credentials.`);
  }

  let credentials;
  try {
    credentials = decryptJson(row.credentials_encrypted);
  } catch (err) {
    throw new Error(`Organization ${normalizedOrgId} has unreadable Google Cloud runtime credentials.`);
  }
  validateRuntimeCredentials(credentials, normalizedOrgId);

  return getVertexClient(context.projectId, context.location, credentials);
}

genai.isVertex = isVertex;
genai.projectId = null;
genai.location = location;
genai.getVertexClient = getVertexClient;
genai.getClientForOrg = getClientForOrg;
log.info(isVertex
  ? "🤖 GoogleGenAI → Vertex AI (organization-scoped; no shared project fallback)"
  : "🤖 GoogleGenAI → Google AI Studio (API key)");

module.exports = genai;
