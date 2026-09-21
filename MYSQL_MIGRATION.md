# MySQL migration

The backend is now MySQL-only.

## Development

1. Copy `.env.example` to `.env`.
2. Keep `DB_ADAPTER=mysql`.
3. Set `MYSQL_URL=mysql://chiefvoice:chiefvoice@db:3306/chiefvoice` when running inside Compose.
4. Start the stack:

```bash
docker compose up -d --build
```

The `db` service is `mysql:8.4`. The same MySQL instance also creates a separate `keycloak` database/user for the Keycloak overlay.

## Keycloak

```bash
docker compose -f docker-compose.yml -f docker-compose.keycloak.yml -f docker-compose.keycloak.dev.yml up -d --build
```

Keycloak uses `jdbc:mysql://db:3306/keycloak`.

## Schema

`src/db/adapters/mysql.js` creates the CRM schema on first boot and adds newly introduced columns idempotently. JSON/array fields are stored as MySQL `JSON`.

## Existing PostgreSQL data

The application code no longer connects to PostgreSQL and the PostgreSQL driver/configuration has been removed. Existing PostgreSQL production data is **not automatically copied** by this code change. If the existing database contains live data that must be preserved, perform a one-time data migration into MySQL before switching production traffic.

## Authentication environments

Development keeps the local Keycloak stack. Production does not run Keycloak.
Production uses Google Cloud Identity Platform; the frontend obtains an Identity
Platform ID token and sends it as `Authorization: Bearer <token>`. The Express
backend verifies that token with the Firebase Admin SDK. Customer organization
membership and roles remain in the CRM MySQL database.
