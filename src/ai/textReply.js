// ============================================================
// services/aiTextReply.js
//
// Text-completion AI replies for chat channels (WhatsApp, Instagram
// DMs) — a lighter-weight sibling to the Live audio sessions in
// vobizProxy.js/twilioProxy.js. Used for optional per-channel
// auto-reply (channel.config.aiAutoReply === true).
// ============================================================

const { getConfigForOrg, buildRuntimePrompt } = require("../config/agentConfig");
const knowledgeBase = require("./knowledgeBase");

const genai = require("./googleAiClient");
const { getLogger } = require("../observability/logger");
const log = getLogger("ai.textReply");

// history: [{ direction: 'inbound'|'outbound', body: string }], oldest first
async function generateReply({ orgId, history, customObjectsPromptSection }) {
  const config = await getConfigForOrg(orgId);
  const basePrompt = buildRuntimePrompt(config);

  // RAG-style: look up the org's knowledge base using the latest inbound
  // message as the query, and inject any matches as grounding context.
  // Single-shot text completion has no function-calling loop here (unlike
  // the Live voice sessions), so this happens once up front rather than
  // via a tool the model chooses to call.
  let knowledgeSection = "";
  const lastInbound = [...history].reverse().find((m) => m.direction === "inbound");
  if (lastInbound?.body) {
    try {
      const matches = await knowledgeBase.search(orgId, lastInbound.body, 3);
      if (matches.length) {
        knowledgeSection = `\n══════════════════════════════════════════\nRELEVANT KNOWLEDGE BASE CONTENT\n══════════════════════════════════════════\nUse this if it helps answer the customer — don't mention it's from a "knowledge base", just use the facts naturally:\n${matches.map((m) => `- ${m.content}`).join("\n")}`;
      }
    } catch (err) {
      log.error("❌ aiTextReply: knowledge base search failed:", err.message);
    }
  }

  const chatPrompt = `${basePrompt}

══════════════════════════════════════════
TEXT CHAT MODE (WhatsApp/Instagram)
══════════════════════════════════════════
You are replying over text chat, not a voice call. Keep replies short —
1-3 sentences, no long paragraphs. No markdown formatting. Use plain,
natural text as a real person would type on WhatsApp.
${customObjectsPromptSection || ""}${knowledgeSection}`;

  const contents = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "model",
    parts: [{ text: m.body || "" }]
  }));

  const aiClient = await genai.getClientForOrg(orgId);
  const res = await aiClient.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents,
    config: { systemInstruction: { parts: [{ text: chatPrompt }] } }
  });

  return (res.text || "").trim();
}

module.exports = { generateReply };
