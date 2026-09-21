// src/routes/settings.js — /api/settings/*

const { safeErrorMessage } = require("../observability/safeError");
const crypto = require("crypto");
const router = require("express").Router();
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const db = require("../db/repository");
const auditLog = require("../platform/auditLog");
const industryPacks = require("../seed/industryPacks");
const { updateConfigForOrg, buildIndustryPersona } = require("../config/agentConfig");
const mailer = require("../email/mailer");
const emailTemplates = require("../email/templates");
const authProvider = require("../auth");
const { getLogger } = require("../observability/logger");
const log = getLogger("routes.settings");

// ── Virtual numbers ──
router.get("/numbers", requireAuth, async (req, res) => {
  try { res.json(await db.list("numbers", req.orgId)); }
  catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.post("/numbers", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    if (req.body.number && !(await db.isNumberAvailable(req.body.number, req.orgId))) {
      return res.status(409).json({ error: "This number is already assigned to another organization." });
    }
    const n = await db.create("numbers", req.orgId, req.body);
    global.broadcastLog(`📞 Assigned virtual number: ${n.number}`, { type: "settings" });
    res.status(201).json(n);
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.patch("/numbers/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    if (req.body.number && !(await db.isNumberAvailable(req.body.number, req.orgId))) {
      return res.status(409).json({ error: "This number is already assigned to another organization." });
    }
    const updated = await db.patch("numbers", req.orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Number not found" });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.delete("/numbers/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    await db.remove("numbers", req.orgId, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.post("/numbers/sync", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body.map(n => n.number).filter(Boolean) : [];
    for (const number of incoming) {
      if (!(await db.isNumberAvailable(number, req.orgId))) {
        return res.status(409).json({ error: `Number "${number}" is already assigned to another organization.` });
      }
    }
    res.json(await db.replaceAll("numbers", req.orgId, req.body));
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

// ── Team members ──
// Returns the logged-in user's own membership info including granted feature flags.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const [membership, org] = await Promise.all([
      db.findMembershipForUser(req.userId, req.userEmail),
      db.getOrg(req.orgId),
    ]);
    const orgFlags = Array.isArray(org?.featureFlags) ? org.featureFlags : [];
    const memberFlags = Array.isArray(membership?.featureFlags) ? membership.featureFlags : [];
    // Org admins get whatever the org-level flags are (controlled by super admin).
    // Other roles get the intersection of personal grants and org-level grants.
    const isOrgAdmin = req.userRole === "Organization Admin";
    const featureFlags = isOrgAdmin
      ? orgFlags
      : memberFlags.filter((f) => orgFlags.includes(f));
    res.json({
      userId: req.userId,
      email: req.userEmail,
      name: req.userName,
      role: req.userRole,
      orgId: req.orgId,
      featureFlags,
      orgFeatureFlags: orgFlags,
    });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.get("/team", requireAuth, async (req, res) => {
  try { res.json(await db.list("team", req.orgId)); }
  catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.post("/team", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { featureFlags, ...memberFields } = req.body;
    const m = await db.addOrgMember(req.orgId, null, { ...memberFields, feature_flags: featureFlags || [] });

    // Dev Keycloak provisions credentials. Production Identity Platform users
    // authenticate through the configured Identity Platform provider (for
    // example Google), so no temporary password is generated or emailed.
    let credsSent = false;
    if (m.email) {
      const tempPassword = process.env.AUTH_PROVIDER === "identity_platform" ? null : crypto.randomBytes(8).toString("base64url");
      try {
        const authUserId = await authProvider.provisionUser(m.email, tempPassword, m.name || "", m.role || "");
        if (authUserId === null) {
          log.info(`ℹ️  Authentication provider did not create credentials for ${m.email}; user will authenticate through the configured provider`);
        } else {
          const org = await db.getOrg(req.orgId);
          const orgName = org?.name || "your organization";
          const tpl = emailTemplates.welcomeEmail({
            orgName,
            adminEmail: m.email,
            tempPassword,
            role: m.role,
          });
          mailer.sendMail({ to: m.email, ...tpl })
            .catch((err) => log.error("⚠️  Welcome email failed:", err.message));
          credsSent = true;
        }
      } catch (authErr) {
        log.error("⚠️  Authentication provider provisioning failed:", authErr.message);
      }
    }

    global.broadcastLog(`👤 Registered team member: ${m.name}`, { type: "settings" });
    auditLog.record(req.orgId, req, "team.add", "team_member", m.id, { name: m.name, role: m.role });
    res.status(201).json({ ...m, credsSent });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.patch("/team/:id/flags", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { featureFlags } = req.body;
    if (!Array.isArray(featureFlags)) return res.status(400).json({ error: "featureFlags must be an array" });
    const updated = await db.patch("team", req.orgId, req.params.id, { featureFlags });
    if (!updated) return res.status(404).json({ error: "Team member not found" });
    auditLog.record(req.orgId, req, "team.flags_update", "team_member", req.params.id, { featureFlags });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.patch("/team/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const updated = await db.patch("team", req.orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Team member not found" });
    auditLog.record(req.orgId, req, "team.update", "team_member", req.params.id, req.body);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.delete("/team/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    await db.remove("team", req.orgId, req.params.id);
    auditLog.record(req.orgId, req, "team.remove", "team_member", req.params.id, {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.post("/team/sync", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try { res.json(await db.replaceTeamMembers(req.orgId, req.body)); }
  catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

// ── Organization settings ──
router.get("/org", requireAuth, async (req, res) => {
  try { res.json(await db.getOrg(req.orgId) || {}); }
  catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.get("/org/profile-config", requireAuth, async (req, res) => {
  try {
    const org = await db.getOrg(req.orgId);
    res.json(industryPacks.getCompanyProfileConfig(org && org.industry));
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

// The universal contact -> campaign -> lead -> opportunity -> client
// pipeline every industry uses, worded to match this org's own industry —
// see industryPacks.js's getPipelineStageLabels.
router.get("/pipeline-stages", requireAuth, async (req, res) => {
  try {
    const org = await db.getOrg(req.orgId);
    res.json({ stages: industryPacks.getPipelineStageLabels(org && org.industry) });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

router.post("/org", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const before = await db.getOrg(req.orgId);
    const updated = await db.updateOrg(req.orgId, req.body);
    const personaInputsChanged = ["industry", "name", "companyBio"].some(k => req.body[k] !== undefined && req.body[k] !== before?.[k]);
    if (personaInputsChanged) {
      await updateConfigForOrg(req.orgId, buildIndustryPersona(updated)).catch((err) =>
        log.error("❌ Failed to auto-regenerate persona after profile update:", err.message)
      );
    }
    global.broadcastLog(`⚙️ Updated organization settings: ${updated.name}`, { type: "settings" });
    auditLog.record(req.orgId, req, "org_settings.update", "organization", req.orgId, req.body);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

module.exports = router;
