// server.js — entry point: GCP credentials, seeding, HTTP server, listen.
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { validateRuntimeConfig } = require("./src/config/runtime");
validateRuntimeConfig(process.env, { mode: "api" });

// ── OpenTelemetry tracing bootstrap — must load before any instrumented
//    module (http, express, pg, ...). No-op unless OTEL_ENABLED=true or
//    OTEL_EXPORTER_OTLP_ENDPOINT is set; see src/observability/tracing.js.
require("./src/observability/tracing");

const { getLogger } = require("./src/observability/logger");
const log = getLogger("server");
const { registerGcpProjectProvisioningJobs } = require("./src/gcp/projectProvisioningJob");

// Write Google Application Credentials JSON to a temp file before any module
// that constructs a Vertex-AI-mode GoogleGenAI client is required — those read
// GOOGLE_APPLICATION_CREDENTIALS at module-load time, and ADC expects a file
// path, not raw JSON content.
// Runtime Vertex credentials are now separate from the GCP project provisioner.
// googleAiClient handles GCP_RUNTIME_CREDENTIALS_JSON/file before constructing clients.

const http = require("http");

// ── Shared state — must be required before telephony registry so that
//    global.broadcastLog is set before any connector module is loaded.
require("./src/shared");

// ── Telephony registry — registers all connectors (gemini, vobiz).
//    Each connector owns its own WebSocketServer instances and Express routes.
//    To add a new provider, edit src/telephony/registry.js only.
const telephony = require("./src/telephony/registry");

// ── Express app
const app = require("./src/app");

// ── Demo data seeding ────────────────────────────────────────────────────────
const db = require("./src/db/repository");
const { DEV_ORG_ID } = require("./src/middleware/auth");
const {
  initialLeads, initialWorkflows, initialCampaigns, initialCallLogs,
  initialLoans, initialVirtualNumbers, initialTeamMembers, initialOrgSettings
} = require("./src/seed/initialData");

async function seedData() {
  if (db.isConfigured()) return;
  if ((await db.list("catalog", DEV_ORG_ID)).length === 0) {
    await db.replaceAll("catalog", DEV_ORG_ID, [
      { id: "P001", name: "Ponni Rice", brand: "Aachi", unit: "kg", price: 58, stock: 480 },
      { id: "P002", name: "Sugar", brand: "Local", unit: "kg", price: 44, stock: 12 },
      { id: "P003", name: "Sunflower Oil", brand: "Gold Winner", unit: "litre", price: 152, stock: 60 },
      { id: "P004", name: "Toor Dal", brand: "Tata Sampann", unit: "kg", price: 138, stock: 35 },
      { id: "P005", name: "Idli Rice", brand: "Aachi", unit: "kg", price: 52, stock: 8 },
      { id: "P006", name: "Salt", brand: "Tata", unit: "packet", price: 22, stock: 200 },
      { id: "P007", name: "Maggi Noodles", brand: "Nestle", unit: "box(12)", price: 144, stock: 18 },
      { id: "P008", name: "Red Chilli Powder", brand: "Aachi", unit: "kg", price: 220, stock: 25 },
      { id: "P009", name: "Toilet Soap", brand: "Santoor", unit: "dozen", price: 312, stock: 14 },
      { id: "P010", name: "Tea Powder", brand: "Red Label", unit: "kg", price: 410, stock: 22 }
    ]);
  }
  if ((await db.list("customers", DEV_ORG_ID)).length === 0) {
    await db.replaceAll("customers", DEV_ORG_ID, [
      { id: "C001", name: "Kavitha Ramesh", phone: "+91 98421 33012", type: "Retail", locality: "K.K. Nagar, Madurai", ltv: 18420, khata: 0 },
      { id: "C002", name: "Selvam Traders", phone: "+91 94432 87711", type: "Wholesale", locality: "Simmakkal, Madurai", ltv: 142300, khata: 8600 },
      { id: "C003", name: "Priya Anand", phone: "+91 90031 22456", type: "Retail", locality: "Anna Nagar, Madurai", ltv: 6210, khata: 450 },
      { id: "C004", name: "Murugan Stores (Sub-dealer)", phone: "+91 96297 70044", type: "Wholesale", locality: "Tallakulam, Madurai", ltv: 261800, khata: 22400 },
      { id: "C005", name: "Lakshmi Narayanan", phone: "+91 89034 51290", type: "Retail", locality: "Goripalayam, Madurai", ltv: 3120, khata: 0 }
    ]);
  }
  if ((await db.list("orders", DEV_ORG_ID)).length === 0) {
    await db.replaceAll("orders", DEV_ORG_ID, [
      { id: "ORD-10231", customer: "Kavitha Ramesh", phone: "+91 98421 33012", items: [{n:"Ponni Rice",q:"5 kg",p:290},{n:"Sunflower Oil",q:"2 litre",p:304},{n:"Toor Dal",q:"1 kg",p:138}], total: 732, status: "Confirmed", source: "AI Call", time: "10:42 AM", delivery: "Delivery" },
      { id: "ORD-10230", customer: "Selvam Traders", phone: "+91 94432 87711", items: [{n:"Ponni Rice",q:"50 kg",p:2900},{n:"Sugar",q:"20 kg",p:880}], total: 3780, status: "Packing", source: "AI Call", time: "10:15 AM", delivery: "Pickup" },
      { id: "ORD-10229", customer: "Priya Anand", phone: "+91 90031 22456", items: [{n:"Maggi Noodles",q:"1 box",p:144},{n:"Tea Powder",q:"0.5 kg",p:205}], total: 349, status: "Out for Delivery", source: "WhatsApp", time: "9:58 AM", delivery: "Delivery" },
      { id: "ORD-10228", customer: "Lakshmi Narayanan", phone: "+91 89034 51290", items: [{n:"Idli Rice",q:"3 kg",p:156},{n:"Salt",q:"2 packet",p:44}], total: 200, status: "Delivered", source: "AI Call", time: "9:20 AM", delivery: "Delivery" },
      { id: "ORD-10227", customer: "Murugan Stores (Sub-dealer)", phone: "+91 96297 70044", items: [{n:"Red Chilli Powder",q:"10 kg",p:2200},{n:"Toilet Soap",q:"5 dozen",p:1560}], total: 3760, status: "Placed", source: "AI Call", time: "8:55 AM", delivery: "Pickup" }
    ]);
  }
}
seedData().catch((err) => log.error("❌ seedData failed:", err.message));

async function seedCRMData() {
  if (db.isConfigured()) return;
  if ((await db.list("leads", DEV_ORG_ID)).length === 0) await db.replaceAll("leads", DEV_ORG_ID, initialLeads);
  if ((await db.list("campaigns", DEV_ORG_ID)).length === 0) await db.replaceAll("campaigns", DEV_ORG_ID, initialCampaigns);
  if ((await db.list("workflows", DEV_ORG_ID)).length === 0) await db.replaceAll("workflows", DEV_ORG_ID, initialWorkflows);
  if ((await db.list("loans", DEV_ORG_ID)).length === 0) await db.replaceAll("loans", DEV_ORG_ID, initialLoans);
  if ((await db.list("calllogs", DEV_ORG_ID)).length === 0) await db.replaceAll("calllogs", DEV_ORG_ID, initialCallLogs);
  if ((await db.list("numbers", DEV_ORG_ID)).length === 0) await db.replaceAll("numbers", DEV_ORG_ID, initialVirtualNumbers);
  if ((await db.list("team", DEV_ORG_ID)).length === 0) await db.replaceAll("team", DEV_ORG_ID, initialTeamMembers);
  const currentOrg = await db.getOrg(DEV_ORG_ID);
  if (!currentOrg) await db.updateOrg(DEV_ORG_ID, initialOrgSettings);
}
seedCRMData().catch((err) => log.error("❌ seedCRMData failed:", err.message));

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket upgrade routing — fully delegated to the telephony registry.
//    Each registered connector handles its own ws paths.
server.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  } catch (_) {
    pathname = request.url.split("?")[0];
  }

  const claimed = telephony.handleUpgrade(request, socket, head, pathname);
  if (!claimed) socket.destroy();
});

// ── Chroma DB seeding ────────────────────────────────────────────────────────
async function seedChromaDB() {
  try {
    const chromaUrl = process.env.CHROMA_URL || "http://chroma-db:8000";
    log.info(`🤖 Checking Chroma DB collection seeding at: ${chromaUrl}`);
    const collectionsRes = await fetch(`${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections`);
    if (!collectionsRes.ok) { log.warn("⚠️ Failed to check Chroma DB collections list"); return; }
    const collections = await collectionsRes.json();
    let targetColl = collections.find(c => c.name === "policy-documents");
    let needsSeed = !targetColl;
    let newCollectionId = targetColl?.id;

    if (targetColl) {
      try {
        const countRes = await fetch(`${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/${targetColl.id}/count`);
        if (countRes.ok) {
          const count = await countRes.json();
          const fs = require("fs"), path = require("path");
          const seedPath = path.join(__dirname, "policy_documents_seed.json");
          const seedCount = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, "utf8")).ids.length : 0;
          if (count === 0 || count !== seedCount) {
            log.info(`📥 Document count mismatch (DB: ${count}, Local Seed: ${seedCount}). Resetting and re-seeding...`);
            await fetch(`${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/${targetColl.name}`, { method: "DELETE" });
            needsSeed = true; targetColl = null;
          }
        }
      } catch (err) { log.warn("⚠️ Failed to query/re-seed collection document count:", err.message); }
    }

    if (needsSeed) {
      if (!targetColl) {
        const createRes = await fetch(`${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "policy-documents", metadata: { description: "Health Insurance Policy Documents" }, get_or_create: true })
        });
        if (!createRes.ok) { log.error("❌ Failed to create collection:", await createRes.text()); return; }
        newCollectionId = (await createRes.json()).id;
      }
      const fs = require("fs"), path = require("path");
      const seedPath = path.join(__dirname, "policy_documents_seed.json");
      if (fs.existsSync(seedPath)) {
        const seedData = JSON.parse(fs.readFileSync(seedPath, "utf8"));
        const mockEmbeddings = new Array(seedData.ids.length).fill(null).map(() => new Array(384).fill(0.0));
        const addRes = await fetch(`${chromaUrl}/api/v2/tenants/default_tenant/databases/default_database/collections/${newCollectionId}/add`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: seedData.ids, embeddings: mockEmbeddings, metadatas: seedData.metadatas, documents: seedData.documents })
        });
        log.info(addRes.ok ? "🎉 Chroma DB seeded successfully!" : `❌ Failed to seed Chroma DB: ${await addRes.text()}`);
      } else {
        log.warn("⚠️ Local Chroma DB seed file policy_documents_seed.json not found!");
      }
    } else {
      log.info(`✅ Chroma DB "policy-documents" collection already has documents. Skipping seed.`);
    }
  } catch (err) {
    log.error("❌ Error checking/seeding Chroma DB:", err.message);
  }
}

// Register background processors before accepting HTTP requests.
registerGcpProjectProvisioningJobs().catch(err => log.error("❌ GCP provisioning worker startup failed:", err.message));

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  log.info(`\n✅ ChiefVoice web server running on port ${PORT}`);
  log.info(`📱 Open on mobile: ${publicUrl}`);
  const wsPaths = telephony.all().flatMap((c) => c.wsPaths);
  log.info(`📡 Active WS paths: ${wsPaths.join(", ")}\n`);

  seedChromaDB();

  // Scheduling is intentionally NOT started in the API process. A dedicated
  // scheduler container owns local schedules in development, and AWS
  // EventBridge will own them in production. The API process only registers
  // durable queue workers.
  const { registerAutoDialWorker } = require("./src/crm/autoDialEngine");
  const { registerDialerRetryWorker } = require("./src/crm/dialerRetryEngine");
  registerAutoDialWorker();
  registerDialerRetryWorker();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Graceful shutdown requested (${signal})`);
  server.close(async () => {
    try {
      const { getQueue } = require("./src/queue");
      await getQueue().stop();
      await require("./src/db/repository").close();
      const dbClient = require("./src/db/client");
      await dbClient.close?.();
      log.info("Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      log.error("Graceful shutdown failed", err);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 15000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
