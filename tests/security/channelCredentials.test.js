const crypto = require("crypto");

describe("channel credentials encryption", () => {
  const originalKey = process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  });

  test("round-trips provider credentials", () => {
    const { encryptJson, decryptJson } = require("../../src/security/channelCredentials");
    const value = { authId: "abc", authToken: "super-secret", phoneNumber: "+911234567890" };
    const encrypted = encryptJson(value);
    expect(encrypted).not.toContain(value.authToken);
    expect(decryptJson(encrypted)).toEqual(value);
  });

  test("tampering is rejected", () => {
    const { encryptJson, decryptJson } = require("../../src/security/channelCredentials");
    const encrypted = encryptJson({ authToken: "secret" });
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptJson(raw.toString("base64"))).toThrow();
  });

  test("wrong key cannot decrypt", () => {
    const { encryptJson, decryptJson } = require("../../src/security/channelCredentials");
    const encrypted = encryptJson({ authToken: "secret" });
    process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    expect(() => decryptJson(encrypted)).toThrow();
  });
});
