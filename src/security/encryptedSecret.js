const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey() {
  const raw = String(process.env.GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY is not configured");
  let key;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try { key = Buffer.from(raw, "base64"); } catch (_) { key = null; }
  }
  if (!key || key.length !== 32) throw new Error("GCP_PROJECT_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex or base64 key");
  return key;
}

function encryptJson(value) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptJson(payload) {
  if (!payload) return null;
  const raw = Buffer.from(payload, "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error("Invalid encrypted credential payload");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

module.exports = { encryptJson, decryptJson };
