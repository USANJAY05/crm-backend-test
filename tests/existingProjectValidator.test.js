jest.mock("google-auth-library", () => ({ GoogleAuth: jest.fn() }));

const { GoogleAuth } = require("google-auth-library");

describe("validateExistingProject", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64);
  });

  test("validates an accessible project and enables Vertex AI", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ data: { name: "projects/123", projectId: "demo-project", displayName: "Demo", lifecycleState: "ACTIVE" } })
      .mockResolvedValueOnce({ data: { billingAccountName: "billingAccounts/123" } })
      .mockResolvedValueOnce({ data: { state: "DISABLED" } })
      .mockResolvedValueOnce({ data: { name: "operations/1" } })
      .mockResolvedValueOnce({ data: { done: true, response: {} } });
    GoogleAuth.mockImplementation(() => ({ getClient: async () => ({ request }) }));
    const { validateExistingProject } = require("../src/gcp/existingProjectValidator");
    const result = await validateExistingProject({
      projectId: "demo-project",
      credentials: { type: "service_account", client_email: "svc@example.com", private_key: "SECRET", project_id: "host-project" },
      location: "asia-south1",
    });
    expect(result.valid).toBe(true);
    expect(result.project.projectNumber).toBe("123");
    expect(result.vertexAI.enabled).toBe(true);
    expect(result.credentialsEncrypted).not.toContain("SECRET");
  });

  test("rejects malformed project IDs before calling Google", async () => {
    const { validateExistingProject } = require("../src/gcp/existingProjectValidator");
    await expect(validateExistingProject({ projectId: "bad", credentials: {}, location: "asia-south1" }))
      .rejects.toThrow("Invalid Google Cloud Project ID");
    expect(GoogleAuth).not.toHaveBeenCalled();
  });
});
