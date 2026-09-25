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

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function hasExplicitRelativeTime(text) {
  return /\b(?:in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?)|\d+\s*(?:minutes?|mins?|hours?|hrs?)\s+(?:later|from\s+now))\b/i.test(text);
}

function hasClockTime(text) {
  return /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:at\s+)\d{1,2}:\d{2}\b/i.test(text);
}

function resolveSpecificCallbackTime(localDateTime, timeZone, callerText) {
  if (!LOCAL_DATETIME_RE.test(String(localDateTime || ""))) return null;

  let resolved = zonedTimeToUtc(localDateTime, timeZone);
  if (!resolved) return null;

  // A caller saying only "2 PM" means the next occurrence of 2 PM in the
  // caller's timezone. If 2 PM has already passed today, schedule tomorrow
  // at the same wall-clock time instead of rejecting the callback.
  if (resolved.getTime() <= Date.now() && hasClockTime(callerText)) {
    const parts = String(localDateTime).match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
    );
    if (!parts) return null;
    const nextDayLocal = new Date(
      Date.UTC(
        Number(parts[1]),
        Number(parts[2]) - 1,
        Number(parts[3]) + 1,
        Number(parts[4]),
        Number(parts[5]),
        Number(parts[6])
      )
    );
    const yyyy = nextDayLocal.getUTCFullYear();
    const mm = String(nextDayLocal.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(nextDayLocal.getUTCDate()).padStart(2, "0");
    const hh = String(nextDayLocal.getUTCHours()).padStart(2, "0");
    const mi = String(nextDayLocal.getUTCMinutes()).padStart(2, "0");
    const ss = String(nextDayLocal.getUTCSeconds()).padStart(2, "0");
    resolved = zonedTimeToUtc(
      `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`,
      timeZone
    );
  }

  return resolved && resolved.getTime() > Date.now() ? resolved : null;
}

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
    + `\n\nMANDATORY SCHEDULING POLICY (overrides legacy wording):\n- Only schedule a callback when the caller explicitly wants a callback AND gives a usable time. Never invent a time and never default to two hours.\n- Relative time must be interpreted from the CURRENT CALLER LOCAL TIME: "5 minutes later", "5 mins later", "in 5 minutes", "in 1 hour" -> return the exact relative minutes; application code computes the actual UTC schedule.\n- Clock times must be returned in strict local format YYYY-MM-DDTHH:mm:ss with no timezone suffix. If the caller says "2 PM" and it is already after 2 PM in the caller timezone, schedule the NEXT DAY at 14:00.\n- "later", "sometime", or "whenever" without a usable time means no callback.\n- HARD SEPARATION: No Answer, no-response, unanswered ringing, silence, wrong-number, and answering-machine calls are NOT callback requests. They must return callbackRequested=false, callbackTimeMentioned=false, callbackRelativeMinutes=null, and callbackLocalDateTime=null. The retry engine handles No Answer separately.
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
