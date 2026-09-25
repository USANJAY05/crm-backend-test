const { GoogleAuth } = require("google-auth-library");
const { encryptJson } = require("../security/encryptedSecret");

const RESOURCE_MANAGER = "https://cloudresourcemanager.googleapis.com/v3";
const SERVICE_USAGE = "https://serviceusage.googleapis.com/v1";
const BILLING = "https://cloudbilling.googleapis.com/v1";
const VERTEX_SERVICE = "aiplatform.googleapis.com";

function sanitizeError(err) {
  const status = err?.response?.status || err?.code;
  if (status === 401) return "The supplied Google Cloud credentials are invalid or expired.";
  if (status === 403) return "The supplied credentials do not have access to this Google Cloud project or the required permissions.";
  if (status === 404) return "The Google Cloud project was not found or is not accessible with the supplied credentials.";
  return "Google Cloud validation failed. Check the project ID, credentials, permissions, and network connection.";
}

function parseCredentials(credentials) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw new Error("Service account credentials are required.");
  if (credentials.type !== "service_account" || !credentials.client_email || !credentials.private_key || !credentials.project_id) {
    throw new Error("Invalid service account JSON. Provide a Google Cloud service account JSON credential.");
  }
  return credentials;
}

function validateProjectId(projectId) {
  const id = String(projectId || "").trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) throw new Error("Invalid Google Cloud Project ID.");
  return id;
}

async function validateExistingProject({ projectId, credentials, location }) {
  const creds = parseCredentials(credentials);
  // Prefer the project_id embedded in the service-account JSON. The optional
  // projectId argument is retained for backwards compatibility with older
  // callers, but a supplied value must match the credential's project.
  const id = validateProjectId(creds.project_id);
  if (projectId !== undefined && projectId !== null && String(projectId).trim() && validateProjectId(projectId) !== id) {
    throw new Error("The Google Cloud Project ID does not match the project_id in the service-account JSON.");
  }
  if (!String(location || "").trim()) throw new Error("Google Cloud region/location is required.");

  let auth;
  try {
    auth = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const projectResponse = await client.request({ url: `${RESOURCE_MANAGER}/projects/${encodeURIComponent(id)}` });
    const project = projectResponse.data;
    if (!project?.projectId) throw new Error("Google Cloud returned no project information.");
    if (project.lifecycleState && project.lifecycleState !== "ACTIVE") throw new Error(`Google Cloud project is not active (state: ${project.lifecycleState}).`);

    let billing;
    try {
      const billingResponse = await client.request({ url: `${BILLING}/projects/${encodeURIComponent(id)}/billingInfo` });
      billing = billingResponse.data;
    } catch (err) {
      if ((err?.response?.status || err?.code) === 403) throw new Error("The supplied credentials can access the project but cannot read its billing configuration.");
      throw err;
    }
    if (!billing?.billingAccountName) throw new Error("This Google Cloud project does not have an active billing account. Vertex AI requires billing to be enabled.");

    const serviceResponse = await client.request({ url: `${SERVICE_USAGE}/projects/${encodeURIComponent(id)}/services/${VERTEX_SERVICE}` });
    const state = serviceResponse.data?.state;
    let enabled = state === "ENABLED";

    if (!enabled) {
      try {
        const enableResponse = await client.request({
          url: `${SERVICE_USAGE}/projects/${encodeURIComponent(id)}/services/${VERTEX_SERVICE}:enable`,
          method: "POST",
          data: {}
        });
        const operation = enableResponse.data;
        if (operation?.name) {
          const started = Date.now();
          while (Date.now() - started < 120000) {
            const opResponse = await client.request({ url: `${SERVICE_USAGE}/${operation.name}` });
            if (opResponse.data?.done) {
              if (opResponse.data.error) throw new Error(opResponse.data.error.message || "Vertex AI API could not be enabled.");
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        enabled = true;
      } catch (err) {
        throw new Error("Vertex AI API is not enabled and the supplied credentials do not have permission to enable it.");
      }
    }

    return {
      valid: true,
      project: {
        projectId: project.projectId,
        projectNumber: project.name?.split("/").pop() || project.projectNumber || null,
        displayName: project.displayName || project.name || project.projectId,
      },
      vertexAI: { enabled },
      billing: { enabled: !!billing.billingAccountName },
      credentialsEncrypted: encryptJson(creds),
    };
  } catch (err) {
    if (err.message && /Invalid service account|Invalid Google Cloud Project|region\/location|Vertex AI API is not enabled|GCP_PROJECT_CREDENTIALS/.test(err.message)) throw err;
    const safe = new Error(sanitizeError(err));
    safe.cause = err;
    throw safe;
  }
}

module.exports = { validateExistingProject, validateProjectId, parseCredentials };
