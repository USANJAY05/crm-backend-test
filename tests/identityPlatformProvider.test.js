describe("Identity Platform auth provider", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.IDENTITY_PLATFORM_PROJECT_ID = "identity-project";
    process.env.IDENTITY_PLATFORM_CREDENTIALS_JSON = JSON.stringify({
      project_id: "identity-project",
      client_email: "identity@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n",
    });
  });

  afterEach(() => {
    delete process.env.IDENTITY_PLATFORM_PROJECT_ID;
    delete process.env.IDENTITY_PLATFORM_CREDENTIALS_JSON;
  });

  test("verifies ID tokens through Firebase Admin SDK", async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      uid: "identity-user",
      sub: "identity-user",
      email: "user@example.com",
      platformAdmin: true,
    });
    const initializeApp = jest.fn().mockReturnValue({
      auth: () => ({ verifyIdToken }),
    });
    jest.mock("firebase-admin", () => ({
      credential: { cert: jest.fn((credentials) => ({ credentials })) },
      initializeApp,
    }));
    jest.mock("../src/observability/logger", () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    }));

    const provider = require("../src/auth/providers/identityPlatform");
    const claims = await provider.verifyToken("id-token");

    expect(claims.uid).toBe("identity-user");
    expect(verifyIdToken).toHaveBeenCalledWith("id-token");
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "identity-project", credential: expect.any(Object) }),
      "identity-platform"
    );
  });

  test("does not generate temporary passwords", async () => {
    jest.mock("firebase-admin", () => ({}));
    jest.mock("../src/observability/logger", () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    }));
    const provider = require("../src/auth/providers/identityPlatform");
    await expect(provider.provisionUser("user@example.com", "temporary-password", "User", "Organization Admin"))
      .resolves.toBeNull();
  });
});
