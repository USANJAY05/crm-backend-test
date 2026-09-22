// AWS Cognito authentication provider.
// Required: COGNITO_USER_POOL_ID, COGNITO_REGION, COGNITO_CLIENT_ID.
// The backend verifies Cognito JWTs and keeps CRM organization/role data in MySQL.
// Admin user creation (AdminCreateUser/AdminSetUserPassword) additionally needs
// IAM credentials with cognito-idp:AdminCreateUser, AdminSetUserPassword and
// AdminUpdateUserAttributes on the pool — either the EC2/ECS instance role or
// explicit AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, same convention as
// src/storage/client.js.
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  UsernameExistsException,
} = require('@aws-sdk/client-cognito-identity-provider');
const { getLogger } = require('../../observability/logger');
const log = getLogger('auth.providers.cognito');

const REGION = process.env.COGNITO_REGION;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

let idpClient;
function getIdpClient() {
  if (!idpClient) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    idpClient = new CognitoIdentityProviderClient({
      region: REGION,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }
  return idpClient;
}

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
async function provisionUser(email, password, name = '', role = '') {
  if (!REGION || !USER_POOL_ID) throw new Error('Cognito authentication is not configured');
  const client = getIdpClient();

  let userId;
  try {
    const createRes = await client.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        ...(name ? [{ Name: 'name', Value: name }] : []),
        ...(role ? [{ Name: 'custom:role', Value: role }] : []),
      ],
      // We send our own welcome email with the temp password below —
      // don't let Cognito also send its default invite.
      MessageAction: 'SUPPRESS',
    }));
    userId = createRes.User?.Username;
  } catch (err) {
    if (err instanceof UsernameExistsException) return null; // already exists
    throw new Error(`Cognito user creation failed: ${err.message}`);
  }
  if (!userId) throw new Error('Cognito user created but no username returned');

  if (password) {
    try {
      await client.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: password,
        // Requires the user to set a new password on first sign-in.
        Permanent: false,
      }));
    } catch (err) {
      throw new Error(`Cognito set-password failed: ${err.message}`);
    }
  }

  return userId;
}
module.exports = { verifyToken, decodeToken, provisionUser };
