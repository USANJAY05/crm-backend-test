// src/ai/postCallAgents/followUpAgent.js
// ============================================================
// Follow-up / caller-name safety net — re-reads the finished transcript to
// catch cases where the live agent promised a callback or learned the
// caller's name but never invoked its save_enquiry tool (live audio
// function-calling isn't 100% reliable).
//
// Callback timing is resolved against the CALLER's own local time (their
// phone number's country code -> IANA timezone — see
// lib/callerTimezone.js), not the server's UTC clock, and computed
// deterministically in CODE rather than trusted from the model's own date
// arithmetic:
//   - A relative phrase ("in 30 minutes", "after an hour") -> the model
//     only has to extract the number of minutes; the actual "now + N
//     minutes" math happens here, so it's exactly right regardless of
//     what the model thinks today's date is.
//   - A specific time and/or date ("5pm today", "tomorrow morning",
//     "March 5th at 3") -> the model resolves it against the caller's own
//     current LOCAL date/time (given in the prompt) and returns a plain
//     wall-clock string with no timezone marker; that string is then
//     converted to the correct UTC instant here using the caller's real
//     timezone offset (DST-aware — see lib/timezoneConvert.js).
// ============================================================

const { z } = require("zod");
const { getEffectivePrompt } = require("../systemAgents");
const { generateStructured } = require("./shared");
const { getCallerTimezone } = require("../../lib/callerTimezone");
const { nowInTimezone, zonedTimeToUtc } = require("../../lib/timezoneConvert");
const db = require("../../db/repository");
const { deriveTranscriptSignals } = require("./decisionEngine");

const FollowUpSchema = z.object({
  callbackRequested: z.boolean().default(false),
  callbackTimeMentioned: z.boolean().default(false),
  callbackRelativeMinutes: z.number().nullable().default(null),
  callbackLocalDateTime: z.string().nullable().default(null),
  enquiryRequested: z.boolean().default(false),
  enquirySummary: z.string().nullable().default(null),
  callerName: z.string().nullable().default(null),
});

const DEFAULT_FOLLOW_UP = {
  callbackRequested: false,
  callbackTimeMentioned: false,
  callbackTime: null,
  enquiryRequested: false,
  enquirySummary: null,
  callerName: null,
};

async function extractFollowUp(
  transcript,
  orgId = null,
  callerPhone = null,
  onUsage,
  { sentiment = null, summary = null, callAnswered = true } = {}
) {
  if (!transcript?.trim() || !callAnswered) return { ...DEFAULT_FOLLOW_UP };

  const timeZone = getCallerTimezone(callerPhone);
  const template = await getEffectivePrompt(orgId, "follow-up-safety-net");
  // Older organization-specific prompt overrides may not contain the new
  // placeholders. Always append the mandatory action policy and current
  // context so legacy overrides cannot re-enable the old default callback
  // or callback-vs-enquiry suppression behavior.
  const prompt = template
    .replace("{callerNow}", nowInTimezone(timeZone))
    .replace("{sentiment}", sentiment == null ? "null" : String(sentiment))
    .replace("{summary}", summary || "(No summary available.)")
    .replace("{transcript}", transcript)
    + `\n\nMANDATORY SCHEDULING POLICY (overrides legacy wording):\n- Only schedule a callback when the caller explicitly wants a callback AND gives a usable time. Never invent a time and never default to two hours.\n- "later", "sometime", or "whenever" without a time means no callback.\n- HARD SEPARATION: No Answer, no-response, unanswered ringing, silence, wrong-number, and answering-machine calls are NOT callback requests. They must return callbackRequested=false, callbackTimeMentioned=false, callbackRelativeMinutes=null, and callbackLocalDateTime=null. The retry engine handles No Answer separately.
- A caller who actually answered and says "I'm busy" is still not a callback until they explicitly request one and provide a usable time.\n- Enquiry means only a meaningful caller question/request that the live agent genuinely could not answer or resolve. If the agent answered it, no enquiry.\n- A valid callback and a valid unresolved enquiry may both exist on the same answered call.\n- Sentiment ${sentiment == null ? "null" : sentiment} is context only; do not turn busy into Negative.\n\nCURRENT CALLER LOCAL TIME: ${nowInTimezone(timeZone)}\nCURRENT SENTIMENT: ${sentiment == null ? "null" : sentiment}\nCURRENT SUMMARY: ${summary || "(none)"}`;

  const result = await generateStructured({
    label: "scheduling-enquiry",
    orgId,
    prompt,
    schema: FollowUpSchema,
    fallback: null,
    onUsage,
  });
  if (!result) return { ...DEFAULT_FOLLOW_UP };

  // Application-level guard: an automatic callback is valid only when the
  // caller explicitly supplied a usable time. The model is never allowed
  // to turn "call me later" into the old default two-hour callback.
  let callbackTime = null;
  let callbackRequested = !!result.callbackRequested && !!result.callbackTimeMentioned;

  if (callbackRequested) {
    if (typeof result.callbackRelativeMinutes === "number" && result.callbackRelativeMinutes > 0) {
      callbackTime = new Date(Date.now() + result.callbackRelativeMinutes * 60000).toISOString();
    } else if (result.callbackLocalDateTime) {
      const resolved = zonedTimeToUtc(result.callbackLocalDateTime, timeZone);
      if (resolved && resolved.getTime() > Date.now()) callbackTime = resolved.toISOString();
    }
    if (!callbackTime) callbackRequested = false;
  }

  // Deterministic safety net: if the Caller explicitly asked to be called
  // back, or said they are busy/unavailable and wants the conversation later,
  // never let a weak model classification turn the answered call into
  // "No Answer". If no caller time was supplied, use the configured callback
  // retry policy time rather than inventing a clock time.
  const signals = deriveTranscriptSignals(transcript);
  const { callerText, explicitCallback, busyRequest, callerSuppliedTime, callerSpoke } = signals;

  if ((explicitCallback || busyRequest) && callAnswered && callerSpoke) {
    callbackRequested = true;

    // Never trust a model-generated time unless the CALLER actually used
    // a time expression. This prevents the model from taking a time from an
    // Agent sentence or inventing one when the caller only said "busy".
    if (!callerSuppliedTime) {
      const policyFields = db.computeRetryFields(1, db.DEFAULT_RETRY_POLICY, callerPhone);
      callbackTime = policyFields.nextRetryAt || null;
    }

    // callbackTimeMentioned describes only what the Caller actually said.
    // The configured fallback time is an application schedule, not a caller
    // supplied time.
    if (!callerSuppliedTime) {
      result.callbackTimeMentioned = false;
      result.callbackRelativeMinutes = null;
      result.callbackLocalDateTime = null;
    }
  }

  // If the caller neither requested a callback nor said they were busy/
  // unavailable, do not create a callback merely because the model guessed
  // one. A callback still requires explicit caller intent.
  if (!explicitCallback && !busyRequest && !callbackTime) {
    callbackRequested = false;
    callbackTime = null;
  }

  return {
    callbackRequested,
    callbackTimeMentioned: !!result.callbackTimeMentioned,
    callbackTime,
    enquiryRequested: !!result.enquiryRequested,
    enquirySummary: result.enquirySummary || null,
    callerName: result.callerName || null,
  };
}
module.exports = { extractFollowUp };
