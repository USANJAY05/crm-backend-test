const { getLogger } = require("../observability/logger");
const log = getLogger("auth.index");
// src/auth/index.js — plug-and-play auth provider
//
// Set AUTH_PROVIDER=cognito for the current deployment
// Each provider exposes the same interface:
//   verifyToken(token)              → decoded JWT payload
//   decodeToken(token)              → decoded without verification
//   provisionUser(email, pw, name, role) → provider-specific provisioning; may return null when deferred

const PROVIDER = (process.env.AUTH_PROVIDER || "cognito").toLowerCase();

const providers = {
  keycloak: () => require("./providers/keycloak"),
  identity_platform: () => require("./providers/identityPlatform"),
  cognito: () => require("./providers/cognito"),
};

if (!providers[PROVIDER]) {
  throw new Error(`[auth] Unknown AUTH_PROVIDER "${PROVIDER}". Choose: ${Object.keys(providers).join(", ")}`);
}

log.info(`🔐 Auth provider: ${PROVIDER}`);
module.exports = providers[PROVIDER]();
