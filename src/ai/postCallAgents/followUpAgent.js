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
  followUpPromised: z.boolean().default(false),
  callerName: z.string().nullable().default(null),
  querySummary: z.string().nullable().default(null),
  // Specifically true when the caller said something like "I'm busy right
  // now" / "call me later" and a callback was agreed on for a LATER
  // attempt — as opposed to followUpPromised alone, which also covers
  // "someone from our team will follow up" (a human callback, not another
  // AI redial). callFinalizer.js only schedules an automatic redial when
  // this is true, never for a generic human-handoff promise.
  callbackRequested: z.boolean().default(false),
  // Exactly one of these two should be set when callbackRequested is
  // true (never both — the prompt tells the model to pick whichever
  // actually matches what the caller said):
  //
  // A relative delay ("call me back in 30 minutes", "after an hour") —
  // just the number of minutes from now. The model should NOT attempt to
  // compute a resulting clock time itself; that happens in code below.
  callbackRelativeMinutes: z.number().nullable().default(null),
  // A specific time and/or date ("5pm", "tomorrow morning", "next
  // Monday at 10") resolved against the caller's own current local
  // date/time (given in the prompt as {callerNow}) — a plain wall-clock
  // string "YYYY-MM-DDTHH:mm:ss", NOT an ISO datetime with a "Z" or
  // offset (there isn't one to know yet — this gets converted to a real
  // UTC instant afterward using the caller's actual timezone).
  callbackLocalDateTime: z.string().nullable().default(null),
});

const DEFAULT_FOLLOW_UP = { followUpPromised: false, callerName: null, querySummary: null, callbackRequested: false, callbackTime: null };

async function extractFollowUp(transcript, orgId = null, callerPhone = null, onUsage) {
  if (!transcript?.trim()) return { ...DEFAULT_FOLLOW_UP };

  const timeZone = getCallerTimezone(callerPhone);
  const template = await getEffectivePrompt(orgId, "follow-up-safety-net");
  const prompt = template
    .replace("{callerNow}", nowInTimezone(timeZone))
    .replace("{transcript}", transcript);

  const result = await generateStructured({
    label: "follow-up",
    orgId,
    prompt,
    schema: FollowUpSchema,
    fallback: null,
    onUsage,
  });
  if (!result) return { ...DEFAULT_FOLLOW_UP };

  // Deterministic resolution — see the module comment above for why
  // neither of these is trusted from the model directly.
  let callbackTime = null;
  if (result.callbackRequested) {
    if (typeof result.callbackRelativeMinutes === "number" && result.callbackRelativeMinutes > 0) {
      callbackTime = new Date(Date.now() + result.callbackRelativeMinutes * 60000).toISOString();
    } else if (result.callbackLocalDateTime) {
      const resolved = zonedTimeToUtc(result.callbackLocalDateTime, timeZone);
      // A resolved time already in the past (the model misread "5pm" as
      // today's 5pm when the call itself happened after 5pm, say) isn't
      // useful — leave callbackTime null so callFinalizer.js falls back
      // to its own default delay instead of scheduling a redial for a
      // moment that's already gone.
      if (resolved && resolved.getTime() > Date.now()) callbackTime = resolved.toISOString();
    }
  }

  return {
    followUpPromised: result.followUpPromised,
    callerName: result.callerName,
    querySummary: result.querySummary,
    callbackRequested: result.callbackRequested,
    callbackTime,
  };
}

module.exports = { extractFollowUp };
