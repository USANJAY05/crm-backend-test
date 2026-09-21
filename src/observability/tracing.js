// src/observability/tracing.js
//
// Optional OpenTelemetry distributed tracing bootstrap. Disabled by default —
// enable by setting OTEL_EXPORTER_OTLP_ENDPOINT (or OTEL_ENABLED=true) in the
// environment, pointing at an OTel Collector. With it off, this module is a
// no-op and nothing about app behavior changes.
//
// IMPORTANT: this must be required before any instrumented module (http,
// express, pg, ...) — see the top of server.js.
//
// Wrapped in try/catch throughout: a tracing failure must never take the
// application down or block startup.

"use strict";

const enabled = process.env.OTEL_ENABLED === "true" || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (enabled) {
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    const { resourceFromAttributes } = require("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

    let version = "0.0.0";
    try { version = require("../../package.json").version || version; } catch (_) { /* ignore */ }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`
      : undefined;

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "chiefvoice-crm-backend",
        [ATTR_SERVICE_VERSION]: version,
      }),
      traceExporter: new OTLPTraceExporter(endpoint ? { url: endpoint } : {}),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Filesystem instrumentation is extremely noisy and has no value
          // for this service — every static asset / config read otherwise
          // becomes a span.
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();
    console.log(`🔭 OpenTelemetry tracing started (endpoint: ${endpoint || "default"})`);

    const shutdown = () => sdk.shutdown().catch(() => {});
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("⚠️ OpenTelemetry tracing failed to start — continuing without it:", err.message);
  }
}

module.exports = { enabled };
