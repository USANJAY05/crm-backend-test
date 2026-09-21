// Resolves the Vertex AI project for an organization.
//
// Organization-scoped runtime traffic MUST have an explicit organization
// project. There is intentionally no shared/global GCP project fallback here:
// falling back could send one tenant's AI traffic to another tenant's project
// and break billing/isolation.
const db = require("../db/repository");
const { getLogger } = require("../observability/logger");
const log = getLogger("ai.googleCloudProjectProvider");

class GoogleCloudProjectProvider {
  async resolveProject() {
    throw new Error("resolveProject() must be implemented by a subclass");
  }
}

class PerOrganizationGoogleCloudProjectProvider extends GoogleCloudProjectProvider {
  constructor() {
    super();
    this.defaultLocation = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  }

  async resolveProject({ orgId } = {}) {
    const normalizedOrgId = String(orgId || "").trim();
    if (!normalizedOrgId) {
      throw new Error("Organization context is required to resolve a Google Cloud project.");
    }

    // Do not convert DB errors into "not configured". A database outage must
    // fail closed instead of causing callers to try a shared/default project.
    const project = await db.getOrgCloudProject(normalizedOrgId);
    if (project?.project_id && ["ready", "retained"].includes(project.status)) {
      return {
        projectId: project.project_id,
        location: project.location || this.defaultLocation,
        source: "per-organization",
      };
    }

    // Compatibility for organizations created before organization_cloud_projects
    // became the first-class source of truth. This is still tenant-specific and
    // is NOT a shared project fallback. New organizations must use the table.
    const org = await db.getOrg(normalizedOrgId);
    const legacy = org?.gcpVertexProject || org?.settings?.gcpVertexProject;
    if (legacy?.projectId && legacy?.status === "ready") {
      log.warn(`Organization ${normalizedOrgId} is using the legacy GCP project configuration; migrate it to organization_cloud_projects.`);
      return {
        projectId: legacy.projectId,
        location: legacy.location || this.defaultLocation,
        source: "legacy-organization",
      };
    }

    throw new Error(
      `Organization ${normalizedOrgId} has no configured ready Google Cloud project. ` +
      "Configure the GCP project in the platform admin organization creation flow."
    );
  }
}

// Kept as compatibility exports for existing imports. Both implementations
// intentionally use the same fail-closed organization-scoped behavior.
class SharedGoogleCloudProjectProvider extends PerOrganizationGoogleCloudProjectProvider {}
class PerAdminGoogleCloudProjectProvider extends PerOrganizationGoogleCloudProjectProvider {}

let activeProvider = null;
function getGoogleCloudProjectProvider() {
  if (!activeProvider) activeProvider = new PerOrganizationGoogleCloudProjectProvider();
  return activeProvider;
}

module.exports = {
  GoogleCloudProjectProvider,
  SharedGoogleCloudProjectProvider,
  PerOrganizationGoogleCloudProjectProvider,
  PerAdminGoogleCloudProjectProvider,
  getGoogleCloudProjectProvider,
};
