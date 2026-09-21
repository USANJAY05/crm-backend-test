/**
 * Tenant-isolation integration tests.
 *
 * These exercise the real tenant-resolution modules with a deterministic fake
 * database boundary. They prove the security invariant without requiring a
 * live MySQL/Google/Vobiz account in CI:
 *   - organization-scoped channel reads cannot cross tenants
 *   - provider external identifiers cannot become ambiguous by type
 *   - organization-scoped GCP resolution cannot use another org's project
 *   - missing/failed tenant resolution fails closed
 */

describe("tenant isolation invariants", () => {
  afterEach(() => jest.resetModules());

  function makeQuery(rows) {
    let result = rows.slice();
    const builder = {
      select: () => builder,
      eq: (field, value) => { result = result.filter((r) => r[field] === value); return builder; },
      maybeSingle: async () => ({ data: result.length ? result[0] : null, error: null }),
    };
    return builder;
  }

  function installChannelDb(rows) {
    jest.mock("../src/db/repository", () => ({
      supabase: {
        from: (table) => {
          if (table !== "channels") throw new Error(`Unexpected table: ${table}`);
          return makeQuery(rows);
        },
      },
    }));
  }

  test("org A cannot read org B's Vobiz channel", async () => {
    installChannelDb([
      { id: "a-vobiz", org_id: "org-a", type: "vobiz", external_id: "+91111", config: {}, credentials_encrypted: "enc-a", status: "connected" },
      { id: "b-vobiz", org_id: "org-b", type: "vobiz", external_id: "+91222", config: {}, credentials_encrypted: "enc-b", status: "connected" },
    ]);
    jest.mock("../src/security/channelCredentials", () => ({ decryptJson: (value) => ({ authId: value === "enc-a" ? "A" : "B", authToken: "secret" }) }));

    const channels = require("../src/channels/engine");
    const a = await channels.getChannel("org-a", "vobiz");
    const b = await channels.getChannel("org-b", "vobiz");

    expect(a.org_id).toBe("org-a");
    expect(a.config.authId).toBe("A");
    expect(b.org_id).toBe("org-b");
    expect(b.config.authId).toBe("B");
  });

  test("external provider identifiers are resolved only within their provider type", async () => {
    installChannelDb([
      { id: "wa-a", org_id: "org-a", type: "whatsapp", external_id: "same-id", config: {}, credentials_encrypted: null },
      { id: "ig-b", org_id: "org-b", type: "instagram", external_id: "same-id", config: {}, credentials_encrypted: null },
    ]);
    const channels = require("../src/channels/engine");

    const whatsapp = await channels.getChannelByExternalId("same-id", "whatsapp");
    const instagram = await channels.getChannelByExternalId("same-id", "instagram");

    expect(whatsapp.org_id).toBe("org-a");
    expect(instagram.org_id).toBe("org-b");
  });

  test("GCP resolver is organization-bound and cannot return another org's project", async () => {
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async (orgId) => ({
        project_id: orgId === "org-a" ? "project-a" : "project-b",
        location: "us-central1",
        status: "ready",
      })),
      getOrg: jest.fn(async () => null),
    }));
    const { PerOrganizationGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    const provider = new PerOrganizationGoogleCloudProjectProvider();

    const a = await provider.resolveProject({ orgId: "org-a" });
    const b = await provider.resolveProject({ orgId: "org-b" });

    expect(a.projectId).toBe("project-a");
    expect(b.projectId).toBe("project-b");
    expect(a.projectId).not.toBe(b.projectId);
  });

  test("GCP resolver fails closed when tenant project lookup fails", async () => {
    jest.mock("../src/db/repository", () => ({
      getOrgCloudProject: jest.fn(async () => { throw new Error("database unavailable"); }),
      getOrg: jest.fn(),
    }));
    const { PerOrganizationGoogleCloudProjectProvider } = require("../src/ai/googleCloudProjectProvider");
    const provider = new PerOrganizationGoogleCloudProjectProvider();

    await expect(provider.resolveProject({ orgId: "org-a" })).rejects.toThrow("database unavailable");
  });
});
