// src/storage/client.js — S3-compatible object storage client factory
//
// Switch providers with a single env var:
//
//   STORAGE_PROVIDER=minio     → MinIO (self-hosted, path-style, no ACLs)
//   STORAGE_PROVIDER=s3        → AWS S3 (virtual-hosted style, standard URLs)
//   STORAGE_PROVIDER=r2        → Cloudflare R2 (path-style, no ACLs)
//
// Provider sets sensible defaults for STORAGE_ENDPOINT and
// STORAGE_FORCE_PATH_STYLE so you only need to supply the four core
// credentials. Any individual var can still be overridden explicitly.
//
// ── Required for all providers ────────────────────────────────────────────────
//   STORAGE_PROVIDER    — s3 | minio | r2  (default: s3; use s3 for OCI S3 Compatibility API)
//   STORAGE_ACCESS_KEY  — access key ID
//   STORAGE_SECRET_KEY  — secret access key
//   STORAGE_BUCKET      — bucket name
//
// ── Required for MinIO / R2 only ──────────────────────────────────────────────
//   STORAGE_ENDPOINT    — e.g. http://minio:9000  or  https://<id>.r2.cloudflarestorage.com
//
// ── Optional (all providers) ──────────────────────────────────────────────────
//   STORAGE_REGION      — region string (default: us-east-1; ignored by MinIO/R2)
//   STORAGE_PUBLIC_URL  — base URL for playback links (public-bucket mode only)
//                         MinIO:  http://localhost:9000/<bucket>
//                         R2:     https://pub-xxx.r2.dev
//                         S3:     leave unset → auto-built as https://<bucket>.s3.<region>.amazonaws.com
//   STORAGE_USE_SIGNED_URLS      — "true" to keep the bucket private and serve
//                                  recordings via short-lived pre-signed URLs
//                                  instead of a permanent public link (default:
//                                  false). No bucket policy/STORAGE_PUBLIC_URL
//                                  needed in this mode — recommended for a
//                                  fresh S3 bucket, which blocks public access
//                                  by default. See src/storage/index.js.
//   STORAGE_SIGNED_URL_TTL_SECONDS — how long a pre-signed URL stays valid
//                                    (default: 3600 = 1 hour); only matters
//                                    when STORAGE_USE_SIGNED_URLS=true.
//
// ── Switching MinIO → AWS S3 ──────────────────────────────────────────────────
//   1. Set  STORAGE_PROVIDER=s3
//   2. Set  STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET, STORAGE_REGION
//   3. Remove (or leave unset) STORAGE_ENDPOINT and STORAGE_PUBLIC_URL
//   That's it — no code change needed.

const { S3Client } = require("@aws-sdk/client-s3");
const { getLogger } = require("../observability/logger");
const log = getLogger("storage.client");

// Provider defaults — values a provider requires but that users
// shouldn't have to look up. Explicit env vars always win over these.
const PROVIDER_DEFAULTS = {
  minio: { forcePathStyle: true },
  s3:    { forcePathStyle: true },
  r2:    { forcePathStyle: true },
};

let _client = null;

function getClient() {
  if (_client) return _client;

  const provider  = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();
  const defaults  = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.minio;

  const endpoint  = process.env.STORAGE_ENDPOINT || undefined;
  const region    = process.env.STORAGE_REGION    || "us-east-1";
  const accessKey = process.env.STORAGE_ACCESS_KEY;
  const secretKey = process.env.STORAGE_SECRET_KEY;
  const pathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== undefined
    ? process.env.STORAGE_FORCE_PATH_STYLE === "true"
    : defaults.forcePathStyle;

  // On AWS, prefer the default credential provider chain (EC2/ECS/Lambda IAM role).
  // Explicit keys remain supported for local development.
  const credentials = accessKey && secretKey ? { accessKeyId: accessKey, secretAccessKey: secretKey } : undefined;

  if (provider === "minio" && !endpoint) {
    throw new Error("[storage] STORAGE_ENDPOINT is required for STORAGE_PROVIDER=minio (e.g. http://minio:9000).");
  }
  if (provider === "r2" && !endpoint) {
    throw new Error("[storage] STORAGE_ENDPOINT is required for STORAGE_PROVIDER=r2 (e.g. https://<id>.r2.cloudflarestorage.com).");
  }

  _client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: pathStyle,
    ...(credentials ? { credentials } : {}),
  });

  const label = endpoint ? `${provider} @ ${endpoint}` : `${provider} / ${region}`;
  log.info(`🗄️  Storage client initialised: ${label} | bucket=${process.env.STORAGE_BUCKET}`);

  return _client;
}

module.exports = { getClient };
