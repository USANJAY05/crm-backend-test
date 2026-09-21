// Google Cloud Identity Platform authentication provider.
//
// Production authentication is intentionally delegated to Identity Platform.
// The frontend signs users in with Identity Platform (for example with Google)
// and sends the resulting ID token to this API as a Bearer token. The backend
// verifies that token with the Firebase Admin SDK, then uses the CRM database
// membership as the source of organization/role authorization.
//
// Required in production:
//   IDENTITY_PLATFORM_PROJECT_ID — Identity Platform / Google Cloud project
//
// Credentials:
//   Prefer Application Default Credentials on the production VM. For an
//   explicit service account, set IDENTITY_PLATFORM_CREDENTIALS_JSON.

const admin = require("firebase-admin");
const { getLogger } = require("../../observability/logger");
const log = getLogger("auth.providers.identity-platform");

const PROJECT_ID = process.env.IDENTITY_PLATFORM_PROJECT_ID;
let app;

function getApp() {
  if (app) return app;

  const options = {};
  if (PROJECT_ID) options.projectId = PROJECT_ID;

  if (process.env.IDENTITY_PLATFORM_CREDENTIALS_JSON) {
    let credentials;
    try {
      credentials = JSON.parse(process.env.IDENTITY_PLATFORM_CREDENTIALS_JSON);
    } catch {
      throw new Error("Invalid IDENTITY_PLATFORM_CREDENTIALS_JSON");
    }
    options.credential = admin.credential.cert(credentials);
  } else {
    options.credential = admin.credential.applicationDefault();
  }

  app = admin.initializeApp(options, "identity-platform");
  return app;
}

async function verifyToken(token) {
  if (!token) throw new Error("Missing Identity Platform ID token");
  const decoded = await getApp().auth().verifyIdToken(token);
  return decoded;
}

function decodeToken(token) {
  try {
    const payload = String(token || "").split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

// Identity Platform is the end-user identity system in production. Customer
// memberships are created by the CRM and linked to the Identity Platform UID
// on first successful login. We deliberately do not generate/send passwords
// here because production sign-in is handled by the configured Identity
// Platform providers (Google, email/password, etc.).
async function provisionUser(email, _password, _name = "", _role = "") {
  log.info("Identity Platform user provisioning deferred to first sign-in", { email });
  return null;
}

module.exports = { verifyToken, decodeToken, provisionUser };
