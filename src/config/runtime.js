// Runtime configuration validation. Keep this small and deterministic so
// startup failures point to configuration rather than failing later in a request.
"use strict";

const { getLogger } = require("../observability/logger");
const log = getLogger("config.runtime");

function required(env, names, errors) {
  for (const name of names) {
    if (!String(env[name] || "").trim()) errors.push(`${name} is required`);
  }
}

function requiredDatabase(env, errors) {
  const hasUrl = String(env.MYSQL_URL || "").trim();
  const hasParts = String(env.MYSQL_HOST || "").trim() && String(env.MYSQL_USER || "").trim() && String(env.MYSQL_DATABASE || "").trim();
  if (!hasUrl && !hasParts) errors.push("MySQL requires MYSQL_URL or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE");
}

function validateRuntimeConfig(env = process.env, { mode = "api" } = {}) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === "production";
  const queueProvider = String(env.QUEUE_PROVIDER || "memory").toLowerCase();
  const schedulerProvider = String(env.SCHEDULER_PROVIDER || (mode === "scheduler" ? "local" : "none")).toLowerCase();

  if (mode === "api" || mode === "scheduler") requiredDatabase(env, errors);

  if (queueProvider === "rabbitmq") {
    required(env, ["RABBITMQ_URL"], errors);
  } else if (queueProvider === "oci" || queueProvider === "oci_queue") {
    required(env, ["OCI_QUEUE_OCID", "OCI_QUEUE_REGION"], errors);
  } else if (queueProvider === "aws_sqs" || queueProvider === "sqs") {
    required(env, ["AWS_REGION", "AWS_SQS_QUEUE_URL"], errors);
  } else if (queueProvider !== "memory") {
    errors.push(`Unsupported QUEUE_PROVIDER="${queueProvider}"`);
  }

  if (mode === "scheduler") {
    if (!["local", "oci", "oci_resource_scheduler", "eventbridge", "aws_eventbridge"].includes(schedulerProvider)) {
      errors.push(`Unsupported SCHEDULER_PROVIDER="${schedulerProvider}"`);
    }
    if (production && ["local"].includes(schedulerProvider)) {
      warnings.push("SCHEDULER_PROVIDER=local runs timing inside the VM. A managed scheduler connector can be enabled later without changing scheduler business logic.");
    }
  }

  if (production && !String(env.ALLOWED_ORIGINS || "").trim()) {
    errors.push("ALLOWED_ORIGINS is required in production");
  }

  if (production && mode === "api" && !String(env.SCHEDULER_TRIGGER_SECRET || "").trim()) {
    errors.push("SCHEDULER_TRIGGER_SECRET is required in production for managed scheduler triggers");
  }

  if (production && mode === "api") {
    required(env, ["INTERNAL_API_SECRET", "SSE_TICKET_SECRET", "VOBIZ_WEBHOOK_SECRET", "META_APP_SECRET", "CHANNEL_CREDENTIALS_ENCRYPTION_KEY"], errors);
    if (String(env.STORAGE_USE_SIGNED_URLS || "").toLowerCase() === "false") {
      warnings.push("STORAGE_USE_SIGNED_URLS=false exposes call recordings if the storage bucket is public");
    }
  }

  if (production && String(env.LOCAL_AUTH_SECRET || "") === "chiefvoice-dev-secret-change-me") {
    errors.push("LOCAL_AUTH_SECRET must not use the development default in production");
  }

  if (!production && queueProvider === "memory") {
    warnings.push("QUEUE_PROVIDER=memory is process-local and is not suitable for multiple API instances");
  }

  if (errors.length) {
    const message = `[config] invalid runtime configuration:\n- ${errors.join("\n- ")}`;
    const error = new Error(message);
    error.code = "INVALID_RUNTIME_CONFIG";
    throw error;
  }

  warnings.forEach((warning) => log.warn(warning));
  return { queueProvider, schedulerProvider, warnings };
}

module.exports = { validateRuntimeConfig };
