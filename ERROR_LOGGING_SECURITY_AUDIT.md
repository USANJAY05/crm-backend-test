# Error Handling & Logging Security Audit

## Fixes

- Structured logger now recursively redacts credentials, bearer tokens, API keys, passwords, secrets, private keys, database URLs, provider tokens, and similarly named fields.
- Error objects are serialized with redacted message/stack data.
- String log arguments are scrubbed for common bearer-token, query-token, and key/value secret patterns.
- Authentication logs no longer print email/preferred-username or raw token-derived identity details; they retain a user identifier and roles for correlation.
- API 5xx responses no longer expose raw `err.message` values. Internal errors return a generic message.
- An error must explicitly opt in with `expose=true` before its message can be returned as a client-facing 4xx error through the shared helper.
- Audit-log metadata is recursively redacted before persistence.
- Sensitive request-body audit events remain supported, but secret-bearing fields are removed by the redaction layer.

## Validation

- `node --check` passes for all modified JavaScript files.
- `tests/sensitiveLogging.test.js` passes.

## Operational note

The application still logs normal operational identifiers such as organization IDs, user IDs, call IDs, and request IDs. These are not authentication secrets, but production log access should remain restricted and audited.
