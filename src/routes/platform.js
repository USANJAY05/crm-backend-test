// ============================================================
// services/platformAdminRoutes.js
//
// Platform-operator API — every route here is cross-org by design.
// Gated by requireAuth + requirePlatformAdmin (email allowlist from
// PLATFORM_ADMIN_EMAILS, see services/auth.js). Mounted at
// /api/platform in server.js.
// ============================================================

const { safeErrorMessage } = require("../observability/safeError");
const express = require("express");
const crypto = require("crypto");
const platformAdmin = require("../platform/admin");
const db = require("../db/repository");
const auditLog = require("../platform/auditLog");
const { enqueueGcpProjectProvisioning, ensureProvisioningRecord } = require("../gcp/projectProvisioningJob");
const mailer = require("../email/mailer");
const emailTemplates = require("../email/templates");
const authProvider = require("../auth");
const { requireAuthIdentityOnly, requirePlatformAdmin } = require("../middleware/auth");
const { getLogger } = require("../observability/logger");
const { validateExistingProject } = require("../gcp/existingProjectValidator");
const { getAllVoicePrompts, setVoicePrompt, getAllSystemPrompts, setGlobalSystemPrompt } = require("../platform/prompts");
const log = getLogger("routes.platform");

const router = express.Router();
router.use(requireAuthIdentityOnly, requirePlatformAdmin);

function handleError(err, res) {
  const status = err.statusCode || 500;
  if (status >= 500) log.error("❌ platformAdminRoutes:", err.message);
  res.status(status).json({ error: safeErrorMessage(err) });
}



// Platform-wide prompt management. Voice prompts are the two master templates
// used by /api/agents/generate-prompt; system prompts are the shared defaults
// used by every org unless that org has its own override.
router.get("/prompts", async (req, res) => {
  try {
    const [voice, system] = await Promise.all([getAllVoicePrompts(), getAllSystemPrompts()]);
    res.json({ voice, system });
  } catch (err) {
    handleError(err, res);
  }
});

router.put("/prompts/voice/:callType", async (req, res) => {
  try {
    const updated = await setVoicePrompt(req.params.callType, req.body?.prompt);
    await auditLog.record(null, { userId: req.userId, userEmail: req.userEmail },
      "platform.prompt.voice.update", "voice_prompt", updated.callType,
      { customized: updated.isCustomized });
    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.put("/prompts/system/:id", async (req, res) => {
  try {
    const updated = await setGlobalSystemPrompt(req.params.id, req.body?.systemPrompt);
    await auditLog.record(null, { userId: req.userId, userEmail: req.userEmail },
      "platform.prompt.system.update", "system_agent", updated.id,
      { customized: updated.isCustomized });
    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

// Lets the frontend silently check "am I a platform admin" (to decide
// whether to show the nav item) without exposing any actual data if not.
router.get("/whoami", (req, res) => {
  res.json({ isPlatformAdmin: true, email: req.userEmail });
});

// Post-call job queue introspection — active/waiting counts per provider
// and any dead-lettered jobs (exhausted 3 retries) awaiting their nightly
// retry. See src/queue.
router.get("/queue-stats", (req, res) => {
  try {
    const { getQueue } = require("../queue");
    res.json(getQueue().getStats());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/stats", async (req, res) => {
  try {
    res.json(await platformAdmin.getStats());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/timeseries", async (req, res) => {
  try {
    res.json(await platformAdmin.getTimeSeries(30));
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/organizations", async (req, res) => {
  try {
    res.json(await platformAdmin.listOrganizations());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/organizations/:id", async (req, res) => {
  try {
    res.json(await platformAdmin.getOrganizationDetail(req.params.id));
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/users", async (req, res) => {
  try {
    res.json(await platformAdmin.listUsers());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/audit-log", async (req, res) => {
  try {
    res.json(await platformAdmin.listAuditLog());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/pricing", async (req, res) => {
  try {
    res.json(await platformAdmin.getPricing());
  } catch (err) {
    handleError(err, res);
  }
});

router.put("/pricing", async (req, res) => {
  try {
    const actor = { userId: req.userId, userEmail: req.userEmail };
    res.json(await platformAdmin.updatePricing(actor, req.body?.costPerMinuteInr, req.body?.phoneCostPerMinute));
  } catch (err) {
    handleError(err, res);
  }
});

// Rates for the call/AI providers this codebase actually integrates with
// (call providers billed per minute/hour, AI providers billed per N
// tokens) with a tax % each — the "Cost" page. Every provider is DEFINED
// in code (costProviders.js's KNOWN_PROVIDERS); this API can only adjust
// an existing one's rate/tax/active state, never create or remove one —
// supporting a new provider (Twilio, etc.) is a code change, and it then
// just appears here with a zero rate. See src/platform/costProviders.js.
router.get("/cost-providers", async (req, res) => {
  try {
    res.json(await platformAdmin.listCostProviders());
  } catch (err) {
    handleError(err, res);
  }
});

router.put("/cost-providers/:key", async (req, res) => {
  try {
    const actor = { userId: req.userId, userEmail: req.userEmail };
    res.json(await platformAdmin.upsertCostProvider(actor, { ...req.body, key: req.params.key }));
  } catch (err) {
    handleError(err, res);
  }
});

// Permanent cost snapshots of deleted organizations (see
// platform/admin.js's deleteOrganization + db.archiveOrgCost) — the cost
// history survives even though the org itself and its call data don't.
router.get("/cost-archive", async (req, res) => {
  try {
    res.json(await platformAdmin.listCostArchive());
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/features", async (req, res) => {
  try {
    res.json(await platformAdmin.getFeatureFlags());
  } catch (err) {
    handleError(err, res);
  }
});

router.put("/features/:key", async (req, res) => {
  try {
    const actor = { userId: req.userId, userEmail: req.userEmail };
    res.json(await platformAdmin.updateFeatureFlag(actor, req.params.key, !!req.body?.enabled));
  } catch (err) {
    handleError(err, res);
  }
});

// POST /api/platform/organizations
// Creates a new workspace (organization) and optionally seeds an initial admin member.
router.post("/organizations", async (req, res) => {
  try {
    const {
      name, workspaceName, industry, subscriptionPlan, adminEmail, adminName, featureFlags,
      gcpProjectMode = "existing", gcpProject, callProvider
    } = req.body || {};
    if (!name || !workspaceName) return res.status(400).json({ error: "name and workspaceName are required" });

    if (!["existing", "automatic"].includes(gcpProjectMode)) {
      return res.status(400).json({ error: "Invalid Google Cloud project mode." });
    }
    if (gcpProjectMode === "automatic") {
      return res.status(400).json({ error: "Automatic Google Cloud project creation is currently unavailable." });
    }
    if (!gcpProject || typeof gcpProject !== "object") {
      return res.status(400).json({ error: "Existing Google Cloud project configuration is required." });
    }

    if (!callProvider || typeof callProvider !== "object") {
      return res.status(400).json({ error: "Call provider configuration is required." });
    }
    const provider = String(callProvider.provider || "vobiz").trim().toLowerCase();
    if (provider !== "vobiz") {
      return res.status(400).json({ error: "Unsupported call provider. Currently supported: vobiz." });
    }
    const authId = String(callProvider.authId || "").trim();
    const authToken = String(callProvider.authToken || "").trim();
    const phoneNumber = String(callProvider.phoneNumber || "").trim();
    if (!authId || !authToken || !phoneNumber) {
      return res.status(400).json({ error: "Vobiz auth ID, auth token, and phone number are required." });
    }
    if (!(await db.isNumberAvailable(phoneNumber, null))) {
      return res.status(409).json({ error: "This call-provider number is already assigned to another organization." });
    }
    const { data: existingCallChannel } = await require("../db/client")
      .from("channels").select("org_id").eq("type", provider).eq("external_id", phoneNumber).limit(1).maybeSingle();
    if (existingCallChannel) {
      return res.status(409).json({ error: "This call-provider number is already connected to another organization." });
    }

    // Validate the external project before creating the CRM organization so a
    // bad credential/project cannot leave a newly-created org partially configured.
    let validatedGcp;
    try {
      validatedGcp = await validateExistingProject({
        projectId: gcpProject.projectId,
        credentials: gcpProject.credentials,
        location: gcpProject.location,
      });
    } catch (err) {
      return res.status(400).json({ error: safeErrorMessage(err, "Google Cloud project validation failed.") });
    }

    const supabase = require("../db/client");

    const { data: nameExists } = await supabase
      .from("organizations").select("id").eq("name", name.trim()).limit(1).maybeSingle();
    if (nameExists) return res.status(409).json({ error: `An organization named "${name}" already exists.` });

    const { data: wsExists } = await supabase
      .from("organizations").select("id").eq("workspace_name", workspaceName.trim()).limit(1).maybeSingle();
    if (wsExists) return res.status(409).json({ error: `Workspace slug "${workspaceName}" is already taken.` });

    if (adminEmail) {
      const { data: emailExists } = await supabase
        .from("org_members").select("id").eq("email", adminEmail.toLowerCase()).limit(1).maybeSingle();
      if (emailExists) return res.status(409).json({ error: `A member with email "${adminEmail}" already belongs to an organization.` });
    }

    const orgFeatureFlags = Array.isArray(featureFlags) ? featureFlags : [];
    const { org, cloudProject, memberId } = await db.createOrganizationSetup({
      name, workspaceName, industry, subscriptionPlan,
      featureFlags: orgFeatureFlags,
      adminEmail, adminName,
      gcpProject: {
        projectId: validatedGcp.project.projectId,
        projectNumber: validatedGcp.project.projectNumber,
        location: gcpProject.location,
        credentialsEncrypted: validatedGcp.credentialsEncrypted,
      },
      callProvider: { provider, authId, authToken, phoneNumber },
    });

    let tempPassword = null;
    if (adminEmail) {
      const normalizedEmail = adminEmail.toLowerCase();
      try {
        const generatedPassword = process.env.AUTH_PROVIDER === "identity_platform" ? null : crypto.randomBytes(8).toString("base64url");
        const authUserId = await authProvider.provisionUser(normalizedEmail, generatedPassword, adminName || "", "Organization Admin");
        if (!authUserId) {
          if ((process.env.AUTH_PROVIDER || "cognito").toLowerCase() === "cognito") {
            throw new Error("Cognito did not return a user id");
          }
          log.info(`ℹ️  Authentication provider deferred credential creation for ${normalizedEmail}`);
        } else {
          if (!memberId) throw new Error("Organization admin membership was not created");
          await db.updateOrgMemberUserId(org.id, memberId, authUserId);
          tempPassword = generatedPassword;
        }
      } catch (provErr) {
        log.error("⚠️  Could not provision auth user:", provErr.message);
        tempPassword = null;
        await db.updateOrg(org.id, { authProvisioningStatus: "failed", authProvisioningError: provErr.message, authProvisioningUpdatedAt: new Date().toISOString() });
      }
      if (tempPassword || tempPassword === null) {
        // An already-existing authentication user is considered provisioned; a thrown
        // error above marks the org as failed and can be retried by an operator.
        const current = await db.getOrg(org.id);
        if (current?.authProvisioningStatus !== "failed") {
          await db.updateOrg(org.id, { authProvisioningStatus: "ready", authProvisioningError: null, authProvisioningUpdatedAt: new Date().toISOString() });
        }
      }

      if (tempPassword) {
        const tpl = emailTemplates.welcomeEmail({ orgName: name, adminEmail: normalizedEmail, tempPassword, role: "Organization Admin" });
        mailer.sendMail({ to: normalizedEmail, ...tpl }).catch((err) => log.error("⚠️  Welcome email failed:", err.message));
      }
    }

    await auditLog.record(null, { userId: req.userId, userEmail: req.userEmail },
      "create_organization", "organization", org.id, {
        name, workspaceName, adminEmail, gcpProjectMode: "existing", gcpProjectId: validatedGcp.project.projectId,
        callProvider: provider, callProviderPhoneNumber: phoneNumber
      });

    res.status(201).json({
      ...org,
      gcpVertexProject: {
        projectId: cloudProject.project_id,
        projectNumber: cloudProject.project_number,
        location: cloudProject.location,
        status: cloudProject.status,
      },
      adminEmailSent: !!(adminEmail && tempPassword),
    });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY" || err?.code === "23505") {
      const constraint = String(err.constraint || "");
      if (constraint.includes("workspace")) return res.status(409).json({ error: "Workspace slug is already taken." });
      if (constraint.includes("name")) return res.status(409).json({ error: "An organization with this name already exists." });
      if (constraint.includes("org_members") || constraint.includes("email")) return res.status(409).json({ error: "A member with this email already belongs to an organization." });
    }
    handleError(err, res);
  }
});

// GET /api/platform/organizations/:id/gcp-project
router.get("/organizations/:id/gcp-project", async (req, res) => {
  try {
    const org = await db.getOrg(req.params.id);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json({ gcpVertexProject: await db.toApiOrgCloudProject(await db.getOrgCloudProject(org.id)) });
  } catch (err) { handleError(err, res); }
});

// POST /api/platform/organizations/:id/gcp-project/provision
// Enqueue a safe/idempotent retry; the HTTP request never waits for GCP.
router.post("/organizations/:id/gcp-project/provision", async (req, res) => {
  try {
    const org = await db.getOrg(req.params.id);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    const current = await db.getOrgCloudProject(org.id);
    if (current?.mode === "existing") {
      return res.status(400).json({ error: "This organization uses an existing Google Cloud project. Automatic provisioning is not used." });
    }
    await ensureProvisioningRecord(org);
    const jobId = enqueueGcpProjectProvisioning({ orgId: org.id, orgName: org.name });
    await auditLog.record(null, { userId: req.userId, userEmail: req.userEmail },
      "queue_gcp_vertex_project_provision", "organization", org.id, { jobId });
    res.status(202).json({ queued: true, jobId, gcpVertexProject: await db.toApiOrgCloudProject(await db.getOrgCloudProject(org.id)) });
  } catch (err) { handleError(err, res); }
});

// DELETE /api/platform/organizations/:id?confirm=<orgName>
// Hard-deletes the org and all its data. Requires the org name in ?confirm= as a safety check.
// GET /api/platform/organizations/:id/features — returns the org's enabled app feature flags
router.get("/organizations/:id/features", async (req, res) => {
  try {
    const org = await db.getOrg(req.params.id);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json({ featureFlags: Array.isArray(org.featureFlags) ? org.featureFlags : [] });
  } catch (err) {
    handleError(err, res);
  }
});

// PUT /api/platform/organizations/:id/features — replace the org's enabled app feature flags
router.put("/organizations/:id/features", async (req, res) => {
  try {
    const { id } = req.params;
    const { featureFlags } = req.body || {};
    if (!Array.isArray(featureFlags)) return res.status(400).json({ error: "featureFlags must be an array of flag keys" });
    const org = await db.getOrg(id);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    const supabase = require("../db/client");
    await supabase.from("organizations").update({ feature_flags: featureFlags }).eq("id", id);
    await auditLog.record(null, { userId: req.userId, userEmail: req.userEmail }, "platform.org.features.update", "organization", id, { featureFlags });
    res.json({ success: true, featureFlags });
  } catch (err) {
    handleError(err, res);
  }
});

// ── Org virtual numbers (platform admin) ──────────────────────────────────
router.get("/organizations/:id/numbers", async (req, res) => {
  try { res.json(await db.list("numbers", req.params.id)); }
  catch (err) { handleError(err, res); }
});

router.post("/organizations/:id/numbers", async (req, res) => {
  try {
    const n = await db.create("numbers", req.params.id, req.body);
    res.status(201).json(n);
  } catch (err) { handleError(err, res); }
});

router.delete("/organizations/:id/numbers/:numberId", async (req, res) => {
  try {
    await db.remove("numbers", req.params.id, req.params.numberId);
    res.json({ ok: true });
  } catch (err) { handleError(err, res); }
});

router.post("/organizations/:id/suspend", async (req, res) => {
  try {
    const { id } = req.params;
    const org = await db.getOrg(id);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const updated = await db.updateOrg(id, { status: "Suspended" });
    const actor = { userId: req.userId, userEmail: req.userEmail };
    await auditLog.record(id, actor, "platform.org.suspend", "organization", id, { name: org.name });
    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.post("/organizations/:id/reactivate", async (req, res) => {
  try {
    const { id } = req.params;
    const org = await db.getOrg(id);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const updated = await db.updateOrg(id, { status: "Active" });
    const actor = { userId: req.userId, userEmail: req.userEmail };
    await auditLog.record(id, actor, "platform.org.reactivate", "organization", id, { name: org.name });
    res.json(updated);
  } catch (err) {
    handleError(err, res);
  }
});

router.delete("/organizations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { confirm } = req.query;
    if (!confirm) return res.status(400).json({ error: "Missing ?confirm=<org name> query parameter" });

    const org = await db.getOrg(id);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    if (org.name !== confirm) return res.status(400).json({ error: "Confirmation name does not match" });

    const actor = { userId: req.userId, userEmail: req.userEmail };
    // Retention policy: CRM deletion does not delete the GCP project. Keep the
    // project record/history so Google Cloud billing remains attributable.
    await db.retainOrgCloudProject(id, org.name).catch(err => log.warn(`⚠️ Could not mark GCP project retained for ${id}: ${err.message}`));
    await platformAdmin.deleteOrganization(id, actor);
    await auditLog.record(null, actor, "platform.org.delete", "organization", id, { name: org.name });
    res.json({ success: true });
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
