// ============================================================
// services/featureFlags.js
//
// Platform-wide feature toggles, controlled live from the super admin
// panel (no redeploy needed). Each flag actually gates real behavior in
// the codebase — see the "gates" column below — not just a cosmetic
// switch. Values are stored in platform_settings under "feature.<key>".
// ============================================================

const platformSettings = require("./settings");

// key -> { label, description, default }
const FLAG_DEFINITIONS = {
  ai_auto_hangup: {
    label: "AI auto-hangup",
    description: "Lets the AI end a call itself once the conversation naturally wraps up (end_call tool). Disable to require the caller or agent to hang up manually.",
    default: true,
  },
  whatsapp_channel: {
    label: "WhatsApp messaging",
    description: "Allows the AI to send WhatsApp messages/documents to callers mid-call.",
    default: true,
  },
  knowledge_base_search: {
    label: "Knowledge base search",
    description: "Allows the AI to search the org's knowledge base / policy documents during a call.",
    default: true,
  },
  email_documents: {
    label: "Email documents",
    description: "Allows the AI to email documents/policy briefs to callers.",
    default: true,
  },
  starhealth_quote: {
    label: "Star Health quoting",
    description: "Allows the AI to collect Star Health quote details and fetch a live quote during insurance outbound calls. Org-wide kill switch — the per-task 'Star Health quoting' toggle also has to be on for a given call.",
    default: false,
  },
};

function keyFor(flag) {
  return `feature.${flag}`;
}

async function isEnabled(flag) {
  const def = FLAG_DEFINITIONS[flag];
  const defaultValue = def ? def.default : false;
  const value = await platformSettings.getSetting(keyFor(flag), defaultValue);
  return value === true || value === "true";
}

async function setEnabled(flag, enabled) {
  if (!FLAG_DEFINITIONS[flag]) throw new Error(`Unknown feature flag: ${flag}`);
  return platformSettings.setSetting(keyFor(flag), !!enabled);
}

async function listFlags() {
  const keys = Object.keys(FLAG_DEFINITIONS);
  const values = await Promise.all(keys.map((k) => isEnabled(k)));
  return keys.map((key, i) => ({
    key,
    label: FLAG_DEFINITIONS[key].label,
    description: FLAG_DEFINITIONS[key].description,
    enabled: values[i],
  }));
}

module.exports = { isEnabled, setEnabled, listFlags, FLAG_DEFINITIONS };
