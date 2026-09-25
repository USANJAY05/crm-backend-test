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
  const prompt = template
    .replace("{callerNow}", nowInTimezone(timeZone))
    .replace("{sentiment}", sentiment == null ? "null" : String(sentiment))
    .replace("{summary}", summary || "(No summary available.)")
    .replace("{transcript}", transcript);

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
