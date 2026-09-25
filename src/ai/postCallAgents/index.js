// src/ai/postCallAgents/index.js
// ============================================================
// Shared, schema-validated post-call AI roles — sentiment analysis, call
// summary, workflow-answer extraction, and the follow-up/callback safety
// net. Each agent lives in its own file in this folder; this just
// re-exports them under the one require("../ai/postCallAgents") every
// telephony provider (vobizProxy.js, twilioProxy.js, piopiyProxy.js,
// geminiProxy.js, geminiPipeline.js, vobizPipeline.js) and
// callFinalizer.js already use, so nothing else needed to change.
//
// Previously each telephony provider hand-rolled its own copy of these
// Gemini calls: prompt string -> JSON.parse -> loose `if (parsed.summary)`
// truthy checks, with no real schema validation. That duplication is
// exactly why the fragmented-transcript bug had to be found and fixed
// three separate times in three separate files. This module defines each
// role once, validates the model's JSON output with Zod (retrying once
// with a corrective prompt on a bad response before falling back to a
// safe default — see shared.js), and every provider file calls into it
// instead of keeping its own copy.
// ============================================================

const { analyzeSentiment } = require("./sentimentAgent");
const { generateCallSummary } = require("./summaryAgent");
const { normalizeQuestions, extractWorkflowAnswers } = require("./workflowAnswersAgent");
const { extractFollowUp } = require("./followUpAgent");
const { MODEL, POST_CALL_PIPELINE_VERSION } = require("./shared");

module.exports = {
  analyzeSentiment,
  generateCallSummary,
  extractWorkflowAnswers,
  extractFollowUp,
  normalizeQuestions,
  MODEL, // the model every post-call agent shares — see callFinalizer.js's usage tracking
  POST_CALL_PIPELINE_VERSION,
};
