const { getSetting, setSetting } = require("./settings");
const {
  CALL_TYPES,
  MASTER_PROMPTS,
  MASTER_PROMPT_INBOUND,
  MASTER_PROMPT_OUTBOUND,
} = require("../config/promptTemplates");
const { SYSTEM_AGENTS } = require("../ai/systemAgents");
const { DIALECT_PROFILES } = require("../config/dialectProfiles");

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



const LANGUAGE_DIALECT_KEY = "prompt.languageDialectCatalog";

function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildDefaultLanguagePrompt(language) {
  return `Speak naturally and clearly in {{language}}. Use correct grammar, natural vocabulary, and culturally appropriate phrasing for the selected dialect. Do not translate word-for-word from English.`;
}

function buildDefaultCatalog() {
  const languages = Object.keys(DIALECT_PROFILES).map((name) => ({
    id: slugify(name),
    language: name,
    prompt: buildDefaultLanguagePrompt(name),
  }));
  const dialectsByLanguage = {};
  for (const [language, dialects] of Object.entries(DIALECT_PROFILES)) {
    dialectsByLanguage[language] = dialects.map((d) => ({
      id: slugify(d.dialect),
      dialect: d.dialect,
      prompt: d.profile,
      examples: Array.isArray(d.examples) ? d.examples : [],
    }));
  }
  return { languages, dialectsByLanguage };
}

function normalizeCatalog(raw) {
  const fallback = buildDefaultCatalog();
  if (!raw || typeof raw !== "object") return fallback;
  return {
    languages: Array.isArray(raw.languages) ? raw.languages : fallback.languages,
    dialectsByLanguage: raw.dialectsByLanguage && typeof raw.dialectsByLanguage === "object"
      ? raw.dialectsByLanguage
      : fallback.dialectsByLanguage,
  };
}

async function getPromptCatalog() {
  const stored = await getSetting(LANGUAGE_DIALECT_KEY, null);
  if (stored) return normalizeCatalog(stored);
  const catalog = buildDefaultCatalog();
  await setSetting(LANGUAGE_DIALECT_KEY, catalog);
  return catalog;
}

async function setPromptCatalog(catalog) {
  const normalized = normalizeCatalog(catalog);
  await setSetting(LANGUAGE_DIALECT_KEY, normalized);
  return normalized;
}

async function addPromptLanguage(input) {
  const catalog = await getPromptCatalog();
  const language = String(input?.language || "").trim();
  if (!language) throw Object.assign(new Error("language is required"), { statusCode: 400 });
  if (catalog.languages.some((x) => x.language.toLowerCase() === language.toLowerCase())) {
    throw Object.assign(new Error(`Language "${language}" already exists`), { statusCode: 400 });
  }
  catalog.languages.push({ id: slugify(language), language, prompt: String(input?.prompt || buildDefaultLanguagePrompt(language)).trim() });
  catalog.dialectsByLanguage[language] = [];
  return setPromptCatalog(catalog);
}

async function updatePromptLanguage(language, input) {
  const catalog = await getPromptCatalog();
  const current = catalog.languages.find((x) => x.language === language);
  if (!current) throw Object.assign(new Error(`Unknown language "${language}"`), { statusCode: 404 });
  current.prompt = String(input?.prompt || "").trim();
  return setPromptCatalog(catalog);
}

async function removePromptLanguage(language) {
  const catalog = await getPromptCatalog();
  if (!catalog.languages.some((x) => x.language === language)) {
    throw Object.assign(new Error(`Unknown language "${language}"`), { statusCode: 404 });
  }
  if (catalog.languages.length <= 1) {
    throw Object.assign(new Error("At least one language must remain configured"), { statusCode: 400 });
  }
  catalog.languages = catalog.languages.filter((x) => x.language !== language);
  delete catalog.dialectsByLanguage[language];
  return setPromptCatalog(catalog);
}

async function addPromptDialect(language, input) {
  const catalog = await getPromptCatalog();
  if (!catalog.languages.some((x) => x.language === language)) {
    throw Object.assign(new Error(`Unknown language "${language}"`), { statusCode: 404 });
  }
  const dialect = String(input?.dialect || "").trim();
  if (!dialect) throw Object.assign(new Error("dialect is required"), { statusCode: 400 });
  const list = catalog.dialectsByLanguage[language] || [];
  if (list.some((x) => x.dialect.toLowerCase() === dialect.toLowerCase())) {
    throw Object.assign(new Error(`Dialect "${dialect}" already exists for "${language}"`), { statusCode: 400 });
  }
  list.push({
    id: slugify(dialect),
    dialect,
    prompt: String(input?.prompt || "").trim(),
    examples: Array.isArray(input?.examples) ? input.examples.filter(Boolean) : [],
  });
  catalog.dialectsByLanguage[language] = list;
  return setPromptCatalog(catalog);
}

async function updatePromptDialect(language, dialect, input) {
  const catalog = await getPromptCatalog();
  const item = (catalog.dialectsByLanguage[language] || []).find((x) => x.dialect === dialect);
  if (!item) throw Object.assign(new Error(`Unknown dialect "${dialect}" for "${language}"`), { statusCode: 404 });
  item.prompt = String(input?.prompt || "").trim();
  item.examples = Array.isArray(input?.examples) ? input.examples.filter(Boolean) : item.examples;
  return setPromptCatalog(catalog);
}

async function removePromptDialect(language, dialect) {
  const catalog = await getPromptCatalog();
  const list = catalog.dialectsByLanguage[language] || [];
  if (!list.some((x) => x.dialect === dialect)) {
    throw Object.assign(new Error(`Unknown dialect "${dialect}" for "${language}"`), { statusCode: 404 });
  }
  catalog.dialectsByLanguage[language] = list.filter((x) => x.dialect !== dialect);
  return setPromptCatalog(catalog);
}

async function getLanguagePrompt(language) {
  const catalog = await getPromptCatalog();
  return catalog.languages.find((x) => x.language === language)?.prompt || "";
}

async function getDialectPrompt(language, dialect) {
  const catalog = await getPromptCatalog();
  return (catalog.dialectsByLanguage[language] || []).find((x) => x.dialect === dialect) || null;
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
  getPromptCatalog,
  addPromptLanguage,
  updatePromptLanguage,
  removePromptLanguage,
  addPromptDialect,
  updatePromptDialect,
  removePromptDialect,
  getLanguagePrompt,
  getDialectPrompt,
};
