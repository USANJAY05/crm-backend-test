// AWS Cognito authentication provider.
// Required: COGNITO_USER_POOL_ID, COGNITO_REGION, COGNITO_CLIENT_ID.
// The backend verifies Cognito JWTs and keeps CRM organization/role data in MySQL.
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { getLogger } = require('../../observability/logger');
const log = getLogger('auth.providers.cognito');

const REGION = process.env.COGNITO_REGION;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

let accessVerifier;
let idVerifier;
function getAccessVerifier() {
  if (!accessVerifier) accessVerifier = CognitoJwtVerifier.create({ userPoolId: USER_POOL_ID, tokenUse: 'access', clientId: CLIENT_ID });
  return accessVerifier;
}
function getIdVerifier() {
  if (!idVerifier) idVerifier = CognitoJwtVerifier.create({ userPoolId: USER_POOL_ID, tokenUse: 'id', clientId: CLIENT_ID });
  return idVerifier;
}
async function verifyToken(token) {
  if (!token) throw new Error('Missing Cognito token');
  if (!REGION || !USER_POOL_ID || !CLIENT_ID) throw new Error('Cognito authentication is not configured');
  try {
    return await getAccessVerifier().verify(token);
  } catch (accessErr) {
    try { return await getIdVerifier().verify(token); }
    catch { throw accessErr; }
  }
}
function decodeToken(token) {
  try { return require('jsonwebtoken').decode(token); } catch { return null; }
}
async function provisionUser(email, _password, _name = '', _role = '') {
  log.info('Cognito user provisioning deferred to configured Cognito sign-in', { email });
  return null;
}
module.exports = { verifyToken, decodeToken, provisionUser };
