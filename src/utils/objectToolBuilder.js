const { getLogger } = require("../observability/logger");
const log = getLogger("utils.objectToolBuilder");
// ============================================================
// services/objectToolBuilder.js
//
// Turns an org's generic custom objects (from objectsEngine.listObjects)
// into Gemini Live function-calling tool declarations + a system-prompt
// section, so a live voice call can actually save data into whatever
// industry pack the org picked at signup (property_lead, patient,
// admission, etc.) — not just the hardcoded lending Lead/Loan tools.
//
// Shared by vobizProxy.js and twilioProxy.js (both build a Gemini Live
// session the same way). geminiProxy.js (the phone-number-less browser
// demo) intentionally doesn't use this — there's no org context there.
// ============================================================

const FIELD_TYPE_TO_SCHEMA = {
  text: "STRING",
  textarea: "STRING",
  date: "STRING", // free-form to keep the model from getting stuck on exact date formats
  phone: "STRING",
  email: "STRING",
  select: "STRING",
  number: "NUMBER",
  currency: "NUMBER",
  boolean: "BOOLEAN"
};

function toolNameForObject(objectKey) {
  return `save_${objectKey}`;
}

// Returns { functionDeclarations, promptSection } — merge functionDeclarations
// into the existing tools[0].functionDeclarations array, and append
// promptSection to the system prompt before opening the Gemini session.
function buildCustomObjectTools(customObjects) {
  if (!customObjects || !customObjects.length) {
    return { functionDeclarations: [], promptSection: "" };
  }

  const functionDeclarations = customObjects.map((object) => {
    const properties = {};
    const required = [];
    for (const field of object.fields) {
      const schemaType = FIELD_TYPE_TO_SCHEMA[field.type] || "STRING";
      const prop = { type: schemaType, description: field.label };
      if (field.type === "select" && field.options && field.options.length) {
        prop.enum = field.options;
      }
      properties[field.key] = prop;
      if (field.required) required.push(field.key);
    }
    return {
      name: toolNameForObject(object.key),
      description: `Save a new ${object.label} record. You MUST call this tool the moment you have the required fields — this is not optional and cannot wait until the end of the call.`,
      parameters: { type: "OBJECT", properties, required }
    };
  });

  const promptSection = `
══════════════════════════════════════════
MANDATORY DATA CAPTURE — ${customObjects.map((o) => o.label).join(", ")}
══════════════════════════════════════════
This business tracks ${customObjects.map((o) => o.label.toLowerCase()).join(" and ")}. As soon as you have collected the required fields for any of these during the conversation, you MUST immediately call the matching save tool — do not wait until the caller says goodbye, do not wait to collect optional fields first, and do not just tell the caller you'll "forward" or "save" their details without actually calling the tool. Saying it without calling the tool means nothing was saved.
${customObjects.map((o) => `→ ${toolNameForObject(o.key)}(${o.fields.map((f) => f.key).join(", ")}) — for a new ${o.label.toLowerCase()} entry. Required: ${o.fields.filter((f) => f.required).map((f) => f.key).join(", ") || "none"}.`).join("\n")}
Do not read these field names aloud to the caller — ask naturally in conversation, then call the tool the instant you have the required fields, quietly in the background.`;

  return { functionDeclarations, promptSection };
}

// Given a tool-call name and its args, finds the matching object (if any)
// and creates the record. Returns null if the name doesn't match any of
// this org's custom-object save tools (caller should fall through to its
// other known tool handlers in that case).
async function handleObjectToolCall(objectsEngine, orgId, customObjects, callName, args) {
  const object = customObjects.find((o) => toolNameForObject(o.key) === callName);
  if (!object) return null;
  try {
    const record = await objectsEngine.createRecord(orgId, object.key, args || {});
    return { success: true, recordId: record.id };
  } catch (err) {
    log.error(`❌ objectToolBuilder: failed to save ${object.key}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { buildCustomObjectTools, handleObjectToolCall, toolNameForObject };
