// Unit tests for the organization-scoped GenAI client factory.
// No network calls are made.
describe("Google AI organization isolation", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      GCP_MULTI_PROJECT_ENABLED: "true",
      GCP_RUNTIME_CREDENTIALS_JSON: JSON.stringify({ type: "service_account", client_email: "platform@example.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----" }),
      GOOGLE_CLOUD_PROJECT: "shared-must-never-be-used",
      GOOGLE_CLOUD_LOCATION: "us-central1",
    };
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  test("rejects missing organization context", async () => {
    jest.mock("../src/db/repository", () => ({}));
    const genai = require("../src/ai/googleAiClient");
    await expect(genai.getClientForOrg()).rejects.toThrow(/Organization context is required/);
  });

  test("requires the organization's encrypted credentials", async () => {
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async () => ({ project_id: "org-a-project", location: "us-central1", status: "ready" })),
      getOrgCloudProjectWithCredentials: jest.fn(async () => ({ project_id: "org-a-project", location: "us-central1", status: "ready", credentials_encrypted: null })),
      getOrg: jest.fn(async () => null),
    }));
    const genai = require("../src/ai/googleAiClient");
    await expect(genai.getClientForOrg("org-a")).rejects.toThrow(/no encrypted Google Cloud runtime credentials/);
  });

  test("never returns a client for a mismatched project row", async () => {
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async () => ({ project_id: "org-a-project", location: "us-central1", status: "ready" })),
      getOrgCloudProjectWithCredentials: jest.fn(async () => ({ project_id: "org-b-project", location: "us-central1", status: "ready", credentials_encrypted: "tampered" })),
      getOrg: jest.fn(async () => null),
    }));
    jest.mock("../src/security/encryptedSecret", () => ({ decryptJson: jest.fn() }));
    const genai = require("../src/ai/googleAiClient");
    await expect(genai.getClientForOrg("org-a")).rejects.toThrow(/incomplete Google Cloud project configuration/);
  });
});
