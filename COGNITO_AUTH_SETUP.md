# Cognito authentication

The current CRM source is configured for AWS Cognito by default.

Backend:

```env
AUTH_PROVIDER=cognito
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=...
COGNITO_CLIENT_ID=...
```

Frontend:

```env
VITE_AUTH_PROVIDER=cognito
VITE_COGNITO_REGION=ap-south-1
VITE_COGNITO_USER_POOL_ID=...
VITE_COGNITO_CLIENT_ID=...
VITE_COGNITO_DOMAIN=...
```

CRM organization membership and roles remain in MySQL. Cognito authenticates the user; the CRM database remains the source of truth for tenant membership and authorization.
