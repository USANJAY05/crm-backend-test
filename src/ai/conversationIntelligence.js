// ============================================================
// services/conversationIntelligence.js
//
// AI-generated summary/sentiment/next-action for a call transcript or
// an inbox conversation thread. Reuses the same Gemini text-generation
// pattern already proven in vobizProxy.js/twilioProxy.js's post-call
// sentiment analysis and aiTextReply.js.
// ============================================================

const genai = require("./googleAiClient");
const db = require("../db/repository");
const channelsEngine = require("../channels/engine");

function parseJsonResponse(text) {
  // Gemini sometimes wraps JSON in ```json ... ``` fences despite instructions not to.
  const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

async function analyzeTranscript(transcriptText, orgId = null) {
  if (!transcriptText || !transcriptText.trim()) {
    return { summary: "No conversation content to analyze.", sentiment: "Neutral", nextAction: "" };
  }

  const prompt = `Analyze this customer conversation transcript and respond with ONLY valid JSON, no markdown fences, no extra text:
{"summary": "one or two sentence summary of what happened", "sentiment": "Positive" | "Neutral" | "Negative", "nextAction": "one short, concrete suggested next step for the business, or empty string if none needed"}

Transcript:
${transcriptText}`;

  const aiClient = await genai.getClientForOrg(orgId);
  const res = await aiClient.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: prompt
  });

  const parsed = parseJsonResponse(res.text || "");
  if (!parsed) {
    return { summary: (res.text || "").slice(0, 300), sentiment: "Neutral", nextAction: "" };
  }
  return {
    summary: parsed.summary || "",
    sentiment: ["Positive", "Neutral", "Negative"].includes(parsed.sentiment) ? parsed.sentiment : "Neutral",
    nextAction: parsed.nextAction || ""
  };
}

async function analyzeCall(orgId, callId) {
  if (!db.supabase) {
    const err = new Error("Conversation intelligence requires the MySQL database to be configured.");
    err.statusCode = 503;
    throw err;
  }
  const { data: call, error } = await db.supabase
    .from("calls")
    .select("id, transcript")
    .eq("id", callId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`[conversationIntelligence.analyzeCall] ${error.message}`);
  if (!call) {
    const err = new Error("Call not found");
    err.statusCode = 404;
    throw err;
  }

  const result = await analyzeTranscript(call.transcript, orgId);

  const { data: updated, error: updateErr } = await db.supabase
    .from("calls")
    .update({ summary: result.summary, sentiment: result.sentiment, next_action: result.nextAction, analyzed_at: new Date().toISOString() })
    .eq("id", callId)
    .select("id, summary, sentiment, next_action, analyzed_at")
    .single();
  if (updateErr) throw new Error(`[conversationIntelligence.analyzeCall] ${updateErr.message}`);

  return { summary: updated.summary, sentiment: updated.sentiment, nextAction: updated.next_action, analyzedAt: updated.analyzed_at };
}

async function analyzeConversation(orgId, conversationId) {
  if (!db.supabase) {
    const err = new Error("Conversation intelligence requires the MySQL database to be configured.");
    err.statusCode = 503;
    throw err;
  }
  const messages = await channelsEngine.listMessages(orgId, conversationId);
  if (!messages.length) {
    const err = new Error("Conversation not found or has no messages");
    err.statusCode = 404;
    throw err;
  }

  const transcriptText = messages
    .map((m) => `${m.direction === "inbound" ? "Contact" : m.sender === "ai" ? "AI Agent" : "Agent"}: ${m.body || ""}`)
    .join("\n");

  const result = await analyzeTranscript(transcriptText);

  const { data: updated, error } = await db.supabase
    .from("conversations")
    .update({ summary: result.summary, sentiment: result.sentiment, next_action: result.nextAction, analyzed_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("org_id", orgId)
    .select("id, summary, sentiment, next_action, analyzed_at")
    .single();
  if (error) throw new Error(`[conversationIntelligence.analyzeConversation] ${error.message}`);

  return { summary: updated.summary, sentiment: updated.sentiment, nextAction: updated.next_action, analyzedAt: updated.analyzed_at };
}

module.exports = { analyzeTranscript, analyzeCall, analyzeConversation };
