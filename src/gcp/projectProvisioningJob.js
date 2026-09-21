const { getQueue } = require("../queue");
const { provisionOrgProject } = require("../ai/googleCloudProjectProvisioner");
const db = require("../db/repository");
const { getLogger } = require("../observability/logger");
const log = getLogger("gcp.projectProvisioningJob");

const JOB_TYPE = "gcp-project-provisioning";
let registered = false;

async function registerGcpProjectProvisioningJobs() {
  if (registered) return;
  const queue = getQueue();
  queue.process(JOB_TYPE, async ({ orgId, orgName }) => {
    await provisionOrgProject({ orgId, orgName });
  }, { concurrency: 2 });
  registered = true;

  // The default queue is intentionally lightweight/in-process. On a restart,
  // recover durable pending/provisioning/failed records from MySQL so a
  // transient process restart does not strand an organization.
  try {
    const rows = await db.listOrgCloudProjectsByStatus(["pending", "provisioning"]);
    for (const row of rows) {
      if (row.organization_id && row.status !== "retained") queue.enqueue(JOB_TYPE, { orgId: row.organization_id, orgName: row.organization_name || "Organization" });
    }
  } catch (err) {
    log.warn(`⚠️ Could not recover GCP provisioning jobs: ${err.message}`);
  }
}

function enqueueGcpProjectProvisioning({ orgId, orgName }) {
  return registerGcpProjectProvisioningJobs().then(() => {
    const jobId = getQueue().enqueue(JOB_TYPE, { orgId, orgName });
    log.info(`📦 Queued GCP project provisioning for ${orgId} (${jobId})`);
    return jobId;
  });
}

async function ensureProvisioningRecord(org) {
  const existing = await db.getOrgCloudProject(org.id);
  if (existing?.status === "ready" || existing?.status === "provisioning") return existing;
  return db.createOrgCloudProject({ orgId: org.id, organizationName: org.name, status: "pending" });
}

module.exports = { JOB_TYPE, registerGcpProjectProvisioningJobs, enqueueGcpProjectProvisioning, ensureProvisioningRecord };
