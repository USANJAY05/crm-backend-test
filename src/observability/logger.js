// src/observability/logger.js
//
// Structured logger following the OpenTelemetry Log Data Model:
//   https://opentelemetry.io/docs/specs/otel/logs/data-model/
//
// Every call emits one JSON line to stdout/stderr with:
//   Timestamp, SeverityText, SeverityNumber, Body, TraceId, SpanId,
//   Attributes (component, logId, orgId, userId, requestId, ...bound context),
//   Resource (service.name, service.version).
//
// TraceId/SpanId are picked up automatically from the active OpenTelemetry
// span when tracing is enabled (see src/observability/tracing.js) — with
// tracing disabled they're simply omitted, the logger still works standalone.
//
// Usage:
//   const { getLogger } = require("../observability/logger");
//   const log = getLogger("telephony.twilioProxy");
//   log.info("Call started", { callSid, orgId });
//   const reqLog = log.child({ requestId: req.logId });   // bind context once
//   reqLog.error("Something failed", err);

"use strict";

const crypto = require("crypto");

let otelTrace = null;
try {
  otelTrace = require("@opentelemetry/api").trace;
} catch (_) {
  // @opentelemetry/api not resolvable — trace/span correlation just no-ops.
}

const SEVERITY = {
  debug: { text: "DEBUG", number: 5 },
  info: { text: "INFO", number: 9 },
  warn: { text: "WARN", number: 13 },
  error: { text: "ERROR", number: 17 },
};

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "chiefvoice-crm-backend";
let SERVICE_VERSION = "0.0.0";
try {
  SERVICE_VERSION = require("../../package.json").version || SERVICE_VERSION;
} catch (_) { /* not critical */ }

function activeSpanContext() {
  if (!otelTrace) return null;
  try {
    const span = otelTrace.getActiveSpan();
    const ctx = span && span.spanContext();
    return ctx && ctx.traceId ? ctx : null;
  } catch (_) {
    return null;
  }
}

const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|auth[-_]?token|private[-_]?key|credentials?(?:_encrypted)?|service[-_]?account|webhook[-_]?secret|database[-_]?url|mysql[-_]?url|gmail[-_]?pass|resend[-_]?api[-_]?key|wasender[-_]?api[-_]?key)/i;
const REDACTED = "[REDACTED]";

function redact(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value == null || typeof value !== "object") return value;
  if (depth > 6) return "[TRUNCATED]";
  if (value instanceof Error) {
    return {
      errorName: value.name,
      errorMessage: redactText(value.message),
      stack: redactText(value.stack),
      code: value.code,
    };
  }
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1, seen));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

function redactText(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|access_token|refresh_token|secret|api_key|webhook_secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(password|passwd|secret|token|api[-_]?key|client[-_]?secret)\s*[=:]\s*([^\s,;]+)/gi, "$1=[REDACTED]");
}

function serializeArg(arg) {
  return redact(arg);
}

function emit(level, component, boundAttrs, args) {
  const sev = SEVERITY[level] || SEVERITY.info;
  const spanCtx = activeSpanContext();

  // Keep the familiar console.log(message, ...extra) calling convention:
  // first string argument is the human-readable Body, anything after it
  // (objects, errors, extra values) is captured under Attributes.details.
  const [first, ...rest] = args;
  const hasStringBody = typeof first === "string";
  const body = hasStringBody ? first : undefined;
  const extras = (hasStringBody ? rest : args).map(serializeArg);

  const record = {
    Timestamp: new Date().toISOString(),
    SeverityText: sev.text,
    SeverityNumber: sev.number,
    Body: body !== undefined ? body : (extras.length <= 1 ? extras[0] : extras),
    TraceId: spanCtx ? spanCtx.traceId : undefined,
    SpanId: spanCtx ? spanCtx.spanId : undefined,
    Attributes: {
      component,
      logId: crypto.randomUUID(),
      ...boundAttrs,
      ...(body !== undefined && extras.length ? { details: extras.length === 1 ? extras[0] : extras } : {}),
    },
    Resource: { "service.name": SERVICE_NAME, "service.version": SERVICE_VERSION },
  };

  const line = JSON.stringify(record);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

class Logger {
  constructor(component, boundAttrs) {
    this.component = component;
    this.boundAttrs = boundAttrs || {};
  }

  // Returns a new logger with extra attributes merged into every future
  // record — use per-request/per-call to attach correlation ids without
  // repeating them on every log line.
  child(extraAttrs) {
    return new Logger(this.component, { ...this.boundAttrs, ...extraAttrs });
  }

  debug(...args) { emit("debug", this.component, this.boundAttrs, args); }
  info(...args) { emit("info", this.component, this.boundAttrs, args); }
  warn(...args) { emit("warn", this.component, this.boundAttrs, args); }
  error(...args) { emit("error", this.component, this.boundAttrs, args); }
}

const cache = new Map();
function getLogger(component) {
  if (!cache.has(component)) cache.set(component, new Logger(component));
  return cache.get(component);
}

module.exports = { getLogger, Logger, redact };
