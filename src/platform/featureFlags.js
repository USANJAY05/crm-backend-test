// ============================================================
// Platform-wide product features + AI capability kill switches.
//
// Product features control what appears in org/member feature pickers.
// AI capabilities control runtime behavior. Both are live settings.
// ============================================================

const platformSettings = require("./settings");

const APP_FEATURE_DEFINITIONS = {
  executive_desk: { label: "Executive Desk", description: "Main dashboard with KPIs and activity overview", default: true },
  leads: { label: "Leads", description: "Contacts actively being worked before becoming an Opportunity or Client", default: true },
  pipeline: { label: "Pipeline", description: "Opportunity and Client contacts managed together", default: true },
  contact_directory: { label: "Contact Directory", description: "Organisation-wide contact book", default: true },
  ai_campaigns: { label: "AI Campaigns", description: "Automated outbound calling campaigns", default: true },
  call_logs: { label: "Call Logs", description: "Full history of inbound and outbound calls", default: true },
  objects: { label: "Contacts (Objects)", description: "Structured contact and company records", default: true },
  workflows: { label: "Workflow Builder", description: "Visual question-flow builder for call scripts", default: true },
  agent_studio: { label: "Agent Studio", description: "AI agent configuration and training", default: true },
  knowledge_base: { label: "Knowledge Base", description: "Internal document and FAQ repository", default: true },
  compliance: { label: "Compliance", description: "Regulatory compliance tracking", default: true },
  audit_log: { label: "Audit Log", description: "Full activity audit trail", default: true },
  reports: { label: "Reports", description: "Analytics and performance reports", default: true },
  unified_inbox: { label: "Unified Inbox", description: "Cross-channel message inbox", default: true },
  loan_lifecycle: { label: "Loan Lifecycle", description: "End-to-end loan processing", default: true },
  enquiries: { label: "Enquiries", description: "Inbound enquiry management", default: true },
  dialer: { label: "Voice Simulator", description: "AI-powered outbound dialer", default: true },
};

const FLAG_DEFINITIONS = {
  ai_auto_hangup: {
    label: "AI auto-hangup",
    description: "Lets the AI end a call itself once the conversation naturally wraps up.",
    default: true,
  },
  whatsapp_channel: {
    label: "WhatsApp messaging",
    description: "Allows the AI to send WhatsApp messages/documents to callers mid-call.",
    default: true,
  },
  knowledge_base_search: {
    label: "Knowledge base search",
    description: "Allows the AI to search the org's knowledge base during a call.",
    default: true,
  },
  email_documents: {
    label: "Email documents",
    description: "Allows the AI to email documents/policy briefs to callers.",
    default: true,
  },
  starhealth_quote: {
    label: "Star Health quoting",
    description: "Allows the AI to collect Star Health quote details and fetch a live quote.",
    default: false,
  },
};

const DEFAULT_GROUPS = [
  { key: "full_access", label: "Full Access", description: "Every currently enabled product feature", featureKeys: Object.keys(APP_FEATURE_DEFINITIONS) },
  { key: "sales_team", label: "Sales Team", description: "Core sales and calling tools", featureKeys: ["executive_desk", "leads", "pipeline", "contact_directory", "ai_campaigns", "dialer", "call_logs", "reports"] },
  { key: "support_team", label: "Support Team", description: "Support, inbox and knowledge tools", featureKeys: ["executive_desk", "contact_directory", "unified_inbox", "enquiries", "knowledge_base", "call_logs"] },
  { key: "loan_ops", label: "Loan Operations", description: "Loan processing and compliance", featureKeys: ["executive_desk", "leads", "pipeline", "loan_lifecycle", "compliance", "contact_directory", "call_logs"] },
  { key: "agent_ops", label: "AI Agent Manager", description: "AI agent configuration and automation", featureKeys: ["executive_desk", "agent_studio", "workflows", "knowledge_base", "ai_campaigns", "call_logs"] },
  { key: "read_only", label: "Read Only", description: "Dashboard and reporting only", featureKeys: ["executive_desk", "reports", "audit_log"] },
];

const APP_KEY_PREFIX = "app_feature.";
const GROUPS_KEY = "feature_groups";

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === "true";
}

async function isEnabled(flag) {
  const def = FLAG_DEFINITIONS[flag];
  const defaultValue = def ? def.default : false;
  return toBool(await platformSettings.getSetting(`feature.${flag}`, defaultValue), defaultValue);
}

async function setEnabled(flag, enabled) {
  if (!FLAG_DEFINITIONS[flag]) throw new Error(`Unknown feature flag: ${flag}`);
  return platformSettings.setSetting(`feature.${flag}`, !!enabled);
}

async function isAppFeatureEnabled(key) {
  const def = APP_FEATURE_DEFINITIONS[key];
  if (!def) return false;
  return toBool(await platformSettings.getSetting(`${APP_KEY_PREFIX}${key}`, def.default), def.default);
}

async function setAppFeatureEnabled(key, enabled) {
  if (!APP_FEATURE_DEFINITIONS[key]) throw new Error(`Unknown app feature: ${key}`);
  return platformSettings.setSetting(`${APP_KEY_PREFIX}${key}`, !!enabled);
}

async function listAppFeatures() {
  const keys = Object.keys(APP_FEATURE_DEFINITIONS);
  const values = await Promise.all(keys.map(isAppFeatureEnabled));
  return keys.map((key, i) => ({
    key,
    scope: "app",
    label: APP_FEATURE_DEFINITIONS[key].label,
    description: APP_FEATURE_DEFINITIONS[key].description,
    enabled: values[i],
    globallyEnabled: values[i],
  }));
}

async function listFlags() {
  const keys = Object.keys(FLAG_DEFINITIONS);
  const values = await Promise.all(keys.map(isEnabled));
  return keys.map((key, i) => ({
    key,
    scope: "capability",
    label: FLAG_DEFINITIONS[key].label,
    description: FLAG_DEFINITIONS[key].description,
    enabled: values[i],
    globallyEnabled: values[i],
  }));
}

async function listAllFlags() {
  return [...await listAppFeatures(), ...await listFlags()];
}

async function getFeatureGroups() {
  const stored = await platformSettings.getSetting(GROUPS_KEY, null);
  const groups = Array.isArray(stored) ? stored : DEFAULT_GROUPS;
  const validKeys = new Set(Object.keys(APP_FEATURE_DEFINITIONS));
  return groups.map((g) => ({
    key: String(g.key),
    label: String(g.label || g.key),
    description: String(g.description || ""),
    featureKeys: Array.isArray(g.featureKeys) ? [...new Set(g.featureKeys.filter((k) => validKeys.has(k)))] : [],
    system: DEFAULT_GROUPS.some((d) => d.key === g.key),
  }));
}

async function saveFeatureGroups(groups) {
  const validKeys = new Set(Object.keys(APP_FEATURE_DEFINITIONS));
  if (!Array.isArray(groups)) throw new Error("groups must be an array");
  const normalized = groups.map((g) => ({
    key: String(g.key || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""),
    label: String(g.label || "").trim(),
    description: String(g.description || "").trim(),
    featureKeys: Array.isArray(g.featureKeys) ? [...new Set(g.featureKeys.filter((k) => validKeys.has(k)))] : [],
  })).filter((g) => g.key && g.label);
  if (new Set(normalized.map((g) => g.key)).size !== normalized.length) {
    throw new Error("Feature group keys must be unique");
  }
  await platformSettings.setSetting(GROUPS_KEY, normalized);
  return getFeatureGroups();
}

async function upsertFeatureGroup(group) {
  const groups = await getFeatureGroups();
  const key = String(group?.key || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) throw new Error("Group key is required");
  const next = {
    key,
    label: String(group?.label || "").trim(),
    description: String(group?.description || "").trim(),
    featureKeys: Array.isArray(group?.featureKeys) ? group.featureKeys : [],
  };
  if (!next.label) throw new Error("Group label is required");
  const index = groups.findIndex((g) => g.key === key);
  if (index >= 0) groups[index] = { ...groups[index], ...next };
  else groups.push(next);
  return saveFeatureGroups(groups);
}

async function deleteFeatureGroup(key) {
  const groups = await getFeatureGroups();
  const next = groups.filter((g) => g.key !== key);
  if (next.length === groups.length) throw new Error("Feature group not found");
  return saveFeatureGroups(next);
}

async function getEnabledAppFeatureKeys() {
  const features = await listAppFeatures();
  return features.filter((f) => f.enabled).map((f) => f.key);
}

async function sanitizeFeatureKeys(keys) {
  const enabled = new Set(await getEnabledAppFeatureKeys());
  return Array.isArray(keys) ? [...new Set(keys.filter((k) => enabled.has(k)))] : [];
}

module.exports = {
  isEnabled,
  setEnabled,
  listFlags,
  listAppFeatures,
  listAllFlags,
  isAppFeatureEnabled,
  setAppFeatureEnabled,
  getFeatureGroups,
  saveFeatureGroups,
  upsertFeatureGroup,
  deleteFeatureGroup,
  getEnabledAppFeatureKeys,
  sanitizeFeatureKeys,
  FLAG_DEFINITIONS,
  APP_FEATURE_DEFINITIONS,
};
