describe("encrypted GCP credential storage", () => {
  const OLD = process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY;
  beforeEach(() => { jest.resetModules(); process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY = "a".repeat(64); });
  afterAll(() => { if (OLD === undefined) delete process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY; else process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY = OLD; });

  test("encrypts and decrypts credentials without returning plaintext", () => {
    const { encryptJson, decryptJson } = require("../src/security/encryptedSecret");
    const credentials = { type: "service_account", client_email: "svc@example.com", private_key: "SECRET" };
    const encrypted = encryptJson(credentials);
    expect(encrypted).not.toContain("SECRET");
    expect(decryptJson(encrypted)).toEqual(credentials);
  });
});
