const { getSetting, setSetting } = require("./settings");
const {
  CALL_TYPES,
  MASTER_PROMPTS,
  MASTER_PROMPT_INBOUND,
  MASTER_PROMPT_OUTBOUND,
} = require("../config/promptTemplates");
const { SYSTEM_AGENTS } = require("../ai/systemAgents");

const VOICE_KEYS = {
  INBOUND: "prompt.voice.INBOUND",
  OUTBOUND: "prompt.voice.OUTBOUND",
};

function normalizeCallType(value) {
  const type = String(value || "").toUpperCase();
  if (!CALL_TYPES.includes(type)) {
    const err = new Error(`Unknown call type "${value}"`);
    err.statusCode = 400;
    throw err;
  }
  return type;
}

function validateVoicePrompt(callType, prompt) {
  const required = [
    "{{agent_name}}", "{{company_name}}", "{{industry}}", "{{language}}",
    "{{dialect}}", "{{dialect_profile}}", "{{dialect_examples}}", "{{business_context}}"
  ];
  const missing = required.filter((token) => !prompt.includes(token));
  if (missing.length) {
    const err = new Error(`Voice prompt must include ${missing.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  return prompt.trim();
}

async function getVoicePrompt(callType) {
  const type = normalizeCallType(callType);
  const defaultPrompt = MASTER_PROMPTS[type];
  const stored = await getSetting(VOICE_KEYS[type], null);
  return {
    callType: type,
    prompt: stored || defaultPrompt,
    defaultPrompt,
    isCustomized: !!stored,
  };
}

async function setVoicePrompt(callType, prompt) {
  const type = normalizeCallType(callType);
  const defaultPrompt = MASTER_PROMPTS[type];
  const trimmed = String(prompt || "").trim();

  if (!trimmed || trimmed === defaultPrompt.trim()) {
    await setSetting(VOICE_KEYS[type], null);
    return getVoicePrompt(type);
  }

  validateVoicePrompt(type, trimmed);
  await setSetting(VOICE_KEYS[type], trimmed);
  return getVoicePrompt(type);
}

async function getAllVoicePrompts() {
  return Promise.all(CALL_TYPES.map(getVoicePrompt));
}

function systemKey(id) {
  return `prompt.system.${id}`;
}

async function getGlobalSystemPrompt(id) {
  const def = SYSTEM_AGENTS.find((a) => a.id === id);
  if (!def) return null;
  return (await getSetting(systemKey(id), null)) || def.systemPrompt;
}

async function getAllSystemPrompts() {
  return Promise.all(SYSTEM_AGENTS.map(async (def) => {
    const prompt = await getGlobalSystemPrompt(def.id);
    return {
      ...def,
      systemPrompt: prompt,
      defaultSystemPrompt: def.systemPrompt,
      isCustomized: prompt !== def.systemPrompt,
    };
  }));
}

async function setGlobalSystemPrompt(id, systemPrompt) {
  const def = SYSTEM_AGENTS.find((a) => a.id === id);
  if (!def) {
    const err = new Error(`Unknown system agent id "${id}"`);
    err.statusCode = 400;
    throw err;
  }

  const trimmed = String(systemPrompt || "").trim();

  // Reuse the exact placeholder validation already enforced for org overrides.
  const { validatePromptTemplate } = require("../ai/systemAgents");
  if (!trimmed || trimmed === def.systemPrompt.trim()) {
    await setSetting(systemKey(id), null);
  } else {
    validatePromptTemplate(id, trimmed);
    await setSetting(systemKey(id), trimmed);
  }

  return {
    ...def,
    systemPrompt: await getGlobalSystemPrompt(id),
    defaultSystemPrompt: def.systemPrompt,
    isCustomized: !!(await getSetting(systemKey(id), null)),
  };
}

module.exports = {
  getVoicePrompt,
  getAllVoicePrompts,
  setVoicePrompt,
  getGlobalSystemPrompt,
  getAllSystemPrompts,
  setGlobalSystemPrompt,
};
