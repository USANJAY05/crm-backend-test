// src/docs/swagger.js — serves Swagger UI + OpenAPI spec
//
// Mounts two routes on the Express app:
//   GET /docs          → Swagger UI (HTML)
//   GET /docs/openapi.yaml → raw OpenAPI 3.1 spec (YAML)
//
// Available in all environments. Disable in production if needed by setting
// DISABLE_SWAGGER=true.

const path = require("path");
const fs   = require("fs");
const swaggerUi = require("swagger-ui-express");
const YAML      = require("yaml");
const { getLogger } = require("../observability/logger");
const log = getLogger("docs.swagger");

const specPath = path.join(__dirname, "openapi.yaml");
const spec     = YAML.parse(fs.readFileSync(specPath, "utf8"));

const swaggerUiOptions = {
  customSiteTitle: "ChiefVoice API Docs",
  customCss: `
    /* ── Brand overrides for Swagger UI ────────────────────── */
    :root {
      --cv-accent: #4f8eff;
    }
    body { background: #080c1a; }
    .swagger-ui .topbar { background: #0f1628; border-bottom: 1px solid rgba(79,142,255,0.18); }
    .swagger-ui .topbar .topbar-wrapper img { display: none; }
    .swagger-ui .topbar .topbar-wrapper::before {
      content: "🎙️  ChiefVoice API";
      color: #e8edf8;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }
    .swagger-ui .info .title { color: #e8edf8; }
    .swagger-ui .info p,
    .swagger-ui .info li,
    .swagger-ui .info table thead tr th,
    .swagger-ui .info table tbody tr td { color: #8a9bbf; }
    .swagger-ui .scheme-container { background: #0f1628; box-shadow: none; border-bottom: 1px solid rgba(79,142,255,0.12); }
    .swagger-ui select { background: #162040; color: #e8edf8; border-color: rgba(79,142,255,0.3); }
    .swagger-ui .opblock-tag { color: #e8edf8; border-color: rgba(79,142,255,0.15); }
    .swagger-ui .opblock-tag:hover { background: rgba(79,142,255,0.06); }
    .swagger-ui .btn.authorize { background: #4f8eff; border-color: #4f8eff; color: #fff; }
    .swagger-ui .btn.authorize svg { fill: #fff; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    tryItOutEnabled: true,
    filter: true,
    displayRequestDuration: true,
  },
};

function mountSwagger(app) {
  if (process.env.DISABLE_SWAGGER === "true") {
    log.info("📄 Swagger UI disabled (DISABLE_SWAGGER=true)");
    return;
  }

  // Serve the raw YAML spec so external tools (Postman, Insomnia, Redocly) can import it.
  app.get("/docs/openapi.yaml", (_req, res) => {
    res.setHeader("Content-Type", "application/yaml");
    res.sendFile(specPath);
  });

  // Also expose it as JSON for tools that prefer that.
  app.get("/docs/openapi.json", (_req, res) => {
    res.json(spec);
  });

  // Swagger UI
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec, swaggerUiOptions));

  log.info("📄 Swagger UI: /docs   |   OpenAPI spec: /docs/openapi.yaml");
}

module.exports = { mountSwagger };
