// Pure unit tests — no DB, no network.
describe("PerOrganizationGoogleCloudProjectProvider", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, GOOGLE_CLOUD_PROJECT: "shared-must-never-be-used", GOOGLE_CLOUD_LOCATION: "us-central1" };
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async (orgId) => orgId === "org-a"
        ? { project_id: "org-a-project", location: "us-central1", status: "ready" }
        : orgId === "org-b"
          ? { project_id: "org-b-project", location: "europe-west1", status: "ready" }
          : null),
      getOrg: jest.fn(async (orgId) => orgId === "legacy"
        ? { id: orgId, gcpVertexProject: { projectId: "legacy-project", location: "us-central1", status: "ready" } }
        : { id: orgId }),
    }));
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  test("returns each organization's dedicated project", async () => {
    const { getGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    const provider = getGoogleCloudProjectProvider();
    const forOrgA = await provider.resolveProject({ orgId: "org-a" });
    const forOrgB = await provider.resolveProject({ orgId: "org-b" });

    expect(forOrgA.projectId).toBe("org-a-project");
    expect(forOrgB.projectId).toBe("org-b-project");
    expect(forOrgA.source).toBe("per-organization");
  });

  test("never falls back to GOOGLE_CLOUD_PROJECT when orgId is missing", async () => {
    const { getGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    await expect(getGoogleCloudProjectProvider().resolveProject({})).rejects.toThrow(/Organization context is required/);
  });

  test("does not convert a database error into a shared-project fallback", async () => {
    jest.resetModules();
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async () => { throw new Error("database unavailable"); }),
    }));
    const { getGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    await expect(getGoogleCloudProjectProvider().resolveProject({ orgId: "org-a" })).rejects.toThrow("database unavailable");
  });

  test("legacy organization project remains tenant-specific", async () => {
    const { getGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    const result = await getGoogleCloudProjectProvider().resolveProject({ orgId: "legacy" });
    expect(result.projectId).toBe("legacy-project");
    expect(result.source).toBe("legacy-organization");
  });
});
