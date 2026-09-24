// src/telephony/callFinalizer.js
// ============================================================
// Shared "a call just ended" pipeline — everything that happens AFTER
// audio stops, independent of which telephony provider carried the call.
//
// Every provider proxy (vobizProxy.js, twilioProxy.js, piopiyProxy.js,
// geminiProxy.js) used to hand-roll its own copy of: merging streamed
// transcript fragments, matching/auto-creating a contact, generating the
// AI summary, extracting workflow Q&A, writing the call_logs row,
// broadcasting the live update, and metering AI-minutes usage. That
// duplication is exactly why the fragmented-transcript bug had to be
// found and fixed four separate times.
//
// A NEW telephony provider only ever needs to write the audio-protocol
// adapter (decode/encode audio, parse/build that provider's WS message
// shapes — genuinely provider-specific, no way around it) and call
// finalizeCallRecord() once its call ends. Everything below this line is
// shared and provider-agnostic.
// ============================================================

const db = require("../db/repository");
const objectsEngine = require("../crm/objectsEngine");
const postCallAgents = require("../ai/postCallAgents");
const storage = require("../storage");
const geminiUsageTracker = require("../ai/geminiUsageTracker");
const { getLogger } = require("../observability/logger");
const log = getLogger("telephony.callFinalizer");

// Uploads a call's recording and returns its public URL (or null on failure/
// not configured). Deliberately NOT part of finalizeCallRecord below: the
// post-call pipeline now runs through a retryable job queue (see
// src/queue), and a temp PCM file gets deleted the moment it's read — a
// retried job re-running this step would find nothing to read. Each
// provider's finalizeCall() must call this ONCE, synchronously, before
// enqueueing the rest of the pipeline, and pass the resulting recordingUrl
// (a plain string — safe to carry in a queued job's data) into the queue.
async function uploadRecording(provider, callId, wavBuffer) {
  if (!storage.isConfigured()) {
    log.warn(`⚠️  [${provider}] recording not saved — STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY / STORAGE_BUCKET are not set.`);
    return null;
  }
  if (!wavBuffer || wavBuffer.length <= 44) return null; // header-only/empty — nothing to upload
  try {
    const url = await storage.upload(`recordings/${callId}.wav`, wavBuffer, { contentType: "audio/wav" });
    log.info(`💾 [${provider}] recording uploaded: ${url}`);
    return url;
  } catch (err) {
    log.error(`❌ [${provider}] upload error:`, err.message);
    return null;
  }
}

// Gemini Live's incremental transcription pushes one entry per word/syllable
// chunk, not one per full utterance — merge consecutive same-speaker
// fragments into one turn so both the stored transcript and the text fed to
// postCallAgents read as an actual conversation instead of dozens of
// one-word lines.
function mergeTranscriptLines(transcriptLines) {
  const merged = [];
  for (const l of transcriptLines) {
    const last = merged[merged.length - 1];
    if (last && last.role === l.role) last.text += l.text;
    else merged.push({ role: l.role, text: l.text });
  }
  return merged;
}

function buildFullTranscript(mergedLines) {
  return mergedLines
    .map(l => `${l.role === "user" ? "Caller" : "Agent"}: ${l.text.trim()}`)
    .join("\n");
}

// Links this call to an existing saved contact by phone match. Does NOT
// create a new contact for an unmatched number — contacts are only ever
// added explicitly, through the UI, not by the AI on its own. Orgs use
// either the lending leads table or the generic objects engine for
// contacts, never both, so try leads first and fall back to objects.
async function matchContact(orgId, callId, callerNumber, direction, extractedCallerName) {
  let leadId = null;
  let resolvedLeadName = null;
  try {
    const leadMatch = await db.findLeadByPhone(orgId, callerNumber);
    if (leadMatch) {
      leadId = leadMatch.id;
      resolvedLeadName = leadMatch.name || null;
    } else {
      const recordMatch = await objectsEngine.findRecordByPhone(orgId, callerNumber);
      if (recordMatch) {
        leadId = recordMatch.id;
        resolvedLeadName = recordMatch.name || null;
      }
    }
  } catch (err) {
    log.error("❌ [callFinalizer] contact match failed:", err.message);
  }

  // No matching contact — the AI no longer creates one on its own (that
  // used to happen here, and in save_contact_details/saveContactDetailsNow
  // below, both removed). A call from/to an unknown number now just
  // stays unlinked to a contact (call_logs.leadId null) instead of
  // silently adding a new Contact Directory entry; contacts are only
  // created explicitly, through the UI. Still resolve a name for the
  // call log DISPLAY, though, from whatever was captured live or by the
  // follow-up safety net — that's just a label, not a new row.
  if (!leadId) {
    try {
      resolvedLeadName = (await db.findCapturedNameForCall(orgId, callId)) || extractedCallerName || resolvedLeadName;
    } catch (err) {
      log.error("❌ [callFinalizer] captured-name lookup failed:", err.message);
    }
  }
  return { leadId, resolvedLeadName };
}

// Real-time contact lookup — called from a live tool (save_contact_details,
// declared in each provider's tool list) the moment a caller gives their
// name/email/location mid-call. Only UPDATES an existing contact's blank
// fields (never overwrites a name/email that's already saved with a new
// guess) — it no longer creates a new contact for an unmatched number; the
// AI has no power to add to Contact Directory on its own. Returns the
// resolved name so the live call can use it right away (e.g. if the
// number was already saved under a different name than what was just
// said, the AI should use the ALREADY-SAVED one, not silently rename it).
async function saveContactDetailsNow(orgId, callerNumber, direction, { name, email, location } = {}) {
  if (!orgId || !callerNumber) return { saved: false, resolvedName: name || null };
  try {
    const leadMatch = await db.findLeadByPhone(orgId, callerNumber);
    if (leadMatch) {
      const patch = {};
      if (!leadMatch.name && name) patch.name = name;
      if (!leadMatch.email && email) patch.email = email;
      if (Object.keys(patch).length > 0) await db.patch("leads", orgId, leadMatch.id, patch);
      return { saved: true, leadId: leadMatch.id, resolvedName: leadMatch.name || name || null, alreadyKnown: true };
    }
    const recordMatch = await objectsEngine.findRecordByPhone(orgId, callerNumber);
    if (recordMatch) {
      return { saved: true, leadId: recordMatch.id, resolvedName: recordMatch.name || name || null, alreadyKnown: true };
    }
    // Unmatched number: no longer creates a new contact — just report
    // the name back so the live call can use it in conversation, without
    // adding anything to Contact Directory.
    return { saved: false, resolvedName: name || null };
  } catch (err) {
    log.error("❌ [callFinalizer] saveContactDetailsNow failed:", err.message);
    return { saved: false, resolvedName: name || null };
  }
}

/**
 * Runs the full post-call pipeline and writes the call_logs row. Call this
 * once, after audio/recording handling is done, regardless of provider.
 *
 * Required:
 *   provider          "vobiz" | "twilio" | "piopiy" | <your new provider> — log label only
 *   orgId             org this call belongs to (no-op if falsy — e.g. dev/browser sessions with no org)
 *   callId            this call's internal id
 *   callerNumber      normalized caller phone number
 *   direction         "inbound" | "outbound"
 *   durationSeconds   call length
 *   sentiment         result of postCallAgents.analyzeSentiment(...).sentiment
 *   recordingUrl      storage URL, or null if upload failed/skipped
 *   transcriptLines   RAW streaming fragments — this function merges them
 *
 * Optional:
 *   extractedCallerName   name pulled by a provider's own follow-up safety net, if any
 *   getWorkflowQuestions  () => string[] | null — questions for Q&A extraction; omit if the
 *                         provider has no wizard-assigned workflow questions for this call
 *   isMachineDetected     vobiz-style answering-machine detection (default false)
 *   attemptNumber         auto-redial attempt number, only meaningful with isMachineDetected
 *   retryContext          auto-redial context to persist, only meaningful with isMachineDetected
 *   sentimentInputTokens/sentimentOutputTokens  token usage from a sentiment
 *                         analysis the caller already ran itself (vobizProxy.js
 *                         does, for its own save_enquiry safety net) — folded
 *                         into this call's "gemini-postcall" cost-tracking
 *                         session below alongside summary/workflow-answers/
 *                         follow-up, instead of being paid for twice or lost.
 *
 * Returns { fullTranscript, mergedTranscriptLines } in case the caller needs
 * them for anything provider-specific — the DB write and broadcast happen
 * internally and are fire-and-forget, matching prior behavior.
 */
async function finalizeCallRecord({
  provider,
  orgId,
  callId,
  callerNumber,
  direction,
  durationSeconds,
  sentiment,
  recordingUrl,
  transcriptLines,
  extractedCallerName = null,
  getWorkflowQuestions = () => null,
  isMachineDetected = false,
  attemptNumber = 1,
  retryContext = null,
  providerCallSid = null,
  // Precomputed by the caller (currently only vobizProxy.js, which already
  // runs this for its own save_enquiry safety net) to avoid a duplicate
  // LLM call — if omitted and there's a transcript, computed here instead
  // so every provider gets the "caller asked to be called back" handling
  // below, not just Vobiz.
  followUp = null,
  sentimentInputTokens = 0,
  sentimentOutputTokens = 0,
}) {
  // Accumulates token usage across every post-call agent this function
  // runs (sentiment's is seeded in from the caller above; follow-up/
  // workflow-answers/summary below add to it via onUsage) into ONE
  // "gemini-postcall" ai_session_usage row per call — see the tracking
  // call near the bottom of this function. Kept separate from the live
  // voice session's own usage row (provider "gemini") since these are a
  // different, far cheaper model (gemini-2.5-flash-lite) and should show
  // as their own cost line, not blended into voice-session cost.
  let postCallInputTokens = sentimentInputTokens;
  let postCallOutputTokens = sentimentOutputTokens;
  const accumulateUsage = ({ inputTokens, outputTokens }) => {
    postCallInputTokens += inputTokens || 0;
    postCallOutputTokens += outputTokens || 0;
  };
  const mergedTranscriptLines = mergeTranscriptLines(transcriptLines);
  const fullTranscript = buildFullTranscript(mergedTranscriptLines);

  if (!orgId) return { fullTranscript, mergedTranscriptLines };

  const transcriptForUi = mergedTranscriptLines.map(l => ({
    speaker: l.role === "user" ? "Customer" : "AI",
    text: l.text.trim(),
    timestamp: new Date().toTimeString().split(" ")[0],
  }));

  // Picked up but never actually engaged — cut the call quickly, said
  // nothing, or gave one throwaway word ("wrong number", "no") before
  // hanging up. This is a real, separate outcome from `status`: such a
  // call still ends up "Completed" (someone did pick up, it wasn't a
  // machine, they never asked for a callback) but no real conversation
  // happened, which every downstream sentiment/summary/conversion number
  // was silently treating the same as an actual answered call. Counting
  // the caller's OWN words (not the AI's) across the whole transcript is
  // a simple, explainable proxy for "did they actually talk" — no extra
  // LLM call needed, and it's monotonic with duration/effort, not just a
  // duration cutoff (a caller can talk plenty in a short call, or say
  // nothing at all in a long one where the AI just kept talking).
  const callerWordCount = mergedTranscriptLines
    .filter(l => l.role === "user")
    .reduce((sum, l) => sum + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const callAnswered = !isMachineDetected && callerWordCount >= 4;

  const { leadId, resolvedLeadName } = await matchContact(orgId, callId, callerNumber, direction, extractedCallerName);

  // Advance contact/campaign -> lead the moment a call to this contact is
  // actually answered and engaged with — the second automatic half of the
  // universal pipeline-stage progression (see mysql.js's
  // leads.pipeline_stage comment; the other automatic step is
  // replaceDialerTasks's ->campaign). Never regresses a contact already
  // past this stage (opportunity/client), and fire-and-forget — a
  // pipeline-stage update is not worth failing call finalization over.
  if (leadId && callAnswered) {
    db.getLeadById(orgId, leadId).then(async (current) => {
      if (current && (!current.pipelineStage || current.pipelineStage === "contact" || current.pipelineStage === "campaign")) {
        await db.patch("leads", orgId, leadId, { pipelineStage: "lead" }).catch(() => {});
      }
    }).catch(() => {});
  }

  // "The caller said they're busy and asked to be called back" — status
  // stays out of "Completed" (which the dialer task queue reads as "this
  // lead is done") and instead becomes "Callback Scheduled" with a
  // best-effort time, driving an automatic redial through the SAME
  // retry-field mechanism already used for "No Answer"/"Answering
  // Machine" (see db.computeRetryFields, services/dialerRetryEngine.js).
  // Only ever computed once per call — vobizProxy.js already runs this
  // for its own save_enquiry safety net and passes the result through
  // here instead of paying for a second identical LLM call.
  if (!followUp && transcriptLines.length > 0) {
    try {
      followUp = await postCallAgents.extractFollowUp(fullTranscript, orgId, callerNumber, accumulateUsage);
    } catch (err) {
      log.error(`❌ [${provider}] follow-up extraction failed; continuing call finalization:`, err.message);
      followUp = null;
    }
  }
  followUp = followUp || { followUpPromised: false, callerName: null, querySummary: null, callbackRequested: false, callbackTime: null };

  let finalStatus = isMachineDetected ? "Answering Machine" : "Completed";
  let callbackTimeToStore = null;
  let callbackReasonToStore = null;
  let retryFieldsToSave = {};
  if (isMachineDetected) {
    retryFieldsToSave = { ...db.computeRetryFields(attemptNumber), retryContext };
  } else if (followUp.callbackRequested) {
    finalStatus = "Callback Scheduled";
    const parsed = followUp.callbackTime ? new Date(followUp.callbackTime) : null;
    const parsedIsUsable = parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
    // No time given, or one that's unparseable/already in the past — still
    // schedule a redial rather than dropping the callback on the floor,
    // just with a generic delay instead of the caller's actual preference.
    callbackTimeToStore = parsedIsUsable ? parsed.toISOString() : null;
    callbackReasonToStore = followUp.querySummary || null;
    retryFieldsToSave = {
      attemptNumber,
      retryStatus: "pending",
      nextRetryAt: parsedIsUsable ? parsed.toISOString() : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      retryContext,
    };
  }

  // Prefer answers already saved live during the call (real-time tool calls);
  // only fall back to post-hoc transcript extraction if none were saved.
  // Computed BEFORE the summary/sentiment below (moved ahead of both) so
  // they can judge/describe the call using what was actually captured,
  // not the transcript alone.
  let callAnswers = [];
  try { callAnswers = await db.getResponsesByCallId(orgId, callId); } catch {}
  if (!callAnswers.length && transcriptLines.length > 0) {
    const questions = getWorkflowQuestions();
    if (questions?.length) {
      try {
        callAnswers = await postCallAgents.extractWorkflowAnswers(fullTranscript, questions, orgId, accumulateUsage);
      } catch (err) {
        log.error(`❌ [${provider}] workflow answer extraction failed; continuing call finalization:`, err.message);
        callAnswers = [];
      }
      for (const { label, question, answer } of callAnswers) {
        if (!question) continue;
        // Entity name must be "leadresponses" (no underscore) — that's the
        // key registered in db/repository.js's ENTITIES map (table name
        // "lead_responses" with the underscore); the previous "lead_responses"
        // entity name here threw "unknown entity" on every call, silently
        // swallowed by this same .catch(), so this fallback write path had
        // never actually persisted anything. Field keys are the entity's
        // camelCase API names (see ENTITIES.leadresponses.fields) — org_id
        // is added automatically by db.create().
        db.create("leadresponses", orgId, {
          callId, question, answer, label: label || question,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }
  }

  let aiSummary = fullTranscript.slice(0, 500);
  let postCallSummary = null;
  if (transcriptLines.length > 0) {
    try {
      postCallSummary = await postCallAgents.generateCallSummary(fullTranscript, orgId, callAnswers, accumulateUsage, callerNumber);
    } catch (err) {
      log.error(`❌ [${provider}] post-call summary failed; continuing call finalization:`, err.message);
      postCallSummary = null;
    }
    if (postCallSummary) {
      aiSummary = postCallSummary.text;

      // The structured post-call summary is the canonical outcome. This is
      // especially important for callback/redial calls: the callback and
      // enquiry decisions must be made from the complete finished-call
      // summary, not from whichever live function call happened to fire.
      if (postCallSummary.callbackRequested) {
        finalStatus = isMachineDetected ? "Answering Machine" : "Callback Scheduled";
        if (!isMachineDetected) {
          const parsed = postCallSummary.callbackTime ? new Date(postCallSummary.callbackTime) : null;
          const usable = parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
          callbackTimeToStore = usable ? parsed.toISOString() : null;
          callbackReasonToStore = postCallSummary.querySummary || callbackReasonToStore || null;
          retryFieldsToSave = {
            attemptNumber,
            retryStatus: "pending",
            nextRetryAt: usable ? parsed.toISOString() : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            retryContext,
          };
        }
      }

      // Save a human-follow-up enquiry from the same canonical outcome when
      // the summary says the AI could not resolve the caller's question.
      // Callback always wins, so one call cannot become both outcomes.
      if (!postCallSummary.callbackRequested && postCallSummary.enquiryRequested && postCallSummary.querySummary) {
        try {
          const existing = await db.list("enquiries", orgId);
          const alreadySaved = (existing || []).some(e => String(e.callId || e.call_id || "") === String(callId));
          if (!alreadySaved) {
            await db.create("enquiries", orgId, {
              callId,
              name: postCallSummary.callerName || resolvedLeadName || null,
              phone: callerNumber || null,
              queryText: postCallSummary.querySummary,
              status: "new",
              createdAt: new Date().toISOString(),
            });
            log.info(`✅ [${provider}] Post-call summary saved enquiry for call ${callId}`);
          }
        } catch (err) {
          log.error(`❌ [${provider}] Post-call summary enquiry save failed:`, err.message);
        }
      }
    }
  }

  // This used to be fire-and-forget (db.create(...).then().catch(), never
  // awaited) — matched prior behavior, but meant a genuine failure OR a
  // hang here was invisible: the caller (processPostCallData, run by the
  // job queue) had already returned by the time this settled, so the queue
  // marked the job a success and never retried, and a stuck/slow insert
  // left NEITHER the "Call logged" success line NOR the "insert error"
  // failure line in the logs — confirmed directly from a production
  // capture where a call's sentiment/cost breakdown both logged normally,
  // then nothing: no call_logs row, no call_completed broadcast, no error
  // anywhere, for over a minute. The frontend's dialer UI (which only
  // advances on that broadcast) and Call Logs / the recording's visibility
  // (which both depend on this row actually existing — the recording
  // itself had already uploaded fine) were both silently stuck as a
  // result.
  //
  // Now: awaited, with a hard timeout so a hung request can't block
  // forever, and re-thrown on failure so the queue's own 3-attempt/backoff
  // retry actually gets a chance to recover a transient DB issue instead
  // of the job being marked done regardless.
  const CALL_LOG_INSERT_TIMEOUT_MS = 20_000;
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);

  try {
    const savedLog = await withTimeout(
      db.create("calllogs", orgId, {
        id: callId,
        leadId,
        leadName: resolvedLeadName || callerNumber,
        callerNumber,
        duration: durationSeconds,
        status: finalStatus,
        sentiment,
        intent: "Unknown",
        transcript: transcriptForUi,
        summary: aiSummary,
        recordingUrl,
        direction,
        createdAt: new Date().toISOString(),
        providerCallSid,
        callbackTime: callbackTimeToStore,
        callbackReason: callbackReasonToStore,
        callAnswered,
        ...retryFieldsToSave,
      }),
      CALL_LOG_INSERT_TIMEOUT_MS,
      `[${provider}] calllogs insert for call ${callId}`
    );
    log.info(`📼 [${provider}] Call logged: ${callerNumber} (${durationSeconds}s, ${sentiment})`);
    if (global.broadcastLog) {
      // Include answers (key-value pairs from workflow variables) in the
      // broadcast so the frontend can store them in callResults without a
      // separate API round-trip. providerCallSid is the telephony
      // provider's own call id (Vobiz CallUUID / Twilio CallSid / Piopiy
      // call id) — the SAME id the frontend already holds the moment it
      // places the call (DialerSimulator.tsx's vobizCallSid etc, set from
      // the initiate-call API's response). Broadcasting it lets the
      // frontend match "this broadcast is MY active call" by exact id
      // instead of comparing phone number strings, which silently never
      // matched whenever the lead's stored number and the provider's
      // reported callerNumber differed in country-code formatting (e.g.
      // "6384670687" vs "+916384670687") — confirmed root cause of the
      // dialer UI staying stuck on "connected" even though this row and
      // broadcast fired correctly.
      // callAnswers is the raw {label, question, answer}[] array (see its
      // declaration above) — must be converted to a {[label]: answer} map
      // here, same as callResults[leadId].answers below, or the frontend
      // (CallLogsView.tsx's Workflow Answers table) ends up trying to
      // render a raw {label, question, answer} object as a table cell,
      // which crashes with React error #31 ("Objects are not valid as a
      // React child") the instant a call_completed broadcast for a call
      // with any workflow answers arrives.
      const answersMap = Object.fromEntries((callAnswers || []).map((a) => [a.label || a.question, a.answer]));
      // In STORAGE_USE_SIGNED_URLS mode, savedLog.recordingUrl is a bare
      // object key, not a playable link — resolve it the same way the
      // /api/call-logs GET route does, so the live "call just completed"
      // broadcast is immediately playable too, not just on next refetch.
      const resolvedRecordingUrl = await storage.resolvePlaybackUrl(savedLog.recordingUrl);
      const enrichedLog = { ...savedLog, recordingUrl: resolvedRecordingUrl, answers: answersMap };
      global.broadcastLog(`📼 [${provider}] Call logged: ${callerNumber} (${durationSeconds}s, ${sentiment})`, { type: "call_completed", orgId, callLog: enrichedLog, providerCallSid });
    }
    if (finalStatus === "Callback Scheduled") {
      log.info(`📅 [${provider}] Callback scheduled for ${callerNumber} — next attempt ${retryFieldsToSave.nextRetryAt}${callbackTimeToStore ? "" : " (caller didn't give a specific time — using a default delay)"}`);
    }
  } catch (err) {
    log.error(`❌ [${provider}] call_logs insert error for call ${callId}:`, err.message);
    throw err; // let the job queue's retry policy take over instead of silently dropping this call
  }

  // If this call was placed for a dialer task (retryContext.taskId/leadId —
  // set at trigger time by autoDialEngine.js or a manual dial; carried
  // forward across redials by dialerRetryEngine.js), reflect this call's
  // outcome directly on that task's row so DialerSimulator.tsx's Active
  // Working List shows it without needing to separately poll/match by
  // phone or provider call id. This is what closes the loop for a
  // scheduled callback: the ORIGINAL call sets the lead to "Callback
  // Scheduled", and — independently, whenever that automatic redial later
  // actually happens — this same code path runs again for the NEW call
  // and flips the same lead to "Completed" (or back to "Callback
  // Scheduled" again, if the caller was busy a second time).
  if (retryContext?.taskId && retryContext?.leadId) {
    try {
      const tasks = await db.list("dialertasks", orgId);
      const task = tasks.find(t => t.id === retryContext.taskId);
      if (task) {
        const callResults = { ...(task.callResults || {}) };
        callResults[retryContext.leadId] = {
          status: finalStatus,
          duration: durationSeconds,
          sentiment,
          intent: "Unknown",
          summary: aiSummary,
          recordingUrl,
          callId,
          callbackTime: callbackTimeToStore,
          callbackReason: callbackReasonToStore,
          callAnswered,
          // Calls placed through the job queue (autoDialEngine.js's
          // continuous dialer, dialerRetryEngine.js's auto-redials) land
          // here instead of DialerSimulator.tsx's own handleHangupCall,
          // which is the only other place this object gets built — and
          // that one DOES attach `answers` (converted from callAnswers'
          // {label,question,answer}[] into the {[label]: answer} map the
          // "Extracted Campaign Answers" panel indexes into). Missing here
          // meant every auto-dialed/auto-redialed call — now the primary
          // calling path — showed "No answer captured" for every workflow
          // variable regardless of labeling, since the panel had nothing
          // to look up at all.
          answers: Object.fromEntries((callAnswers || []).map((a) => [a.label || a.question, a.answer])),
        };
        // A completed call must release the task's in-flight lease here, not
        // only via the auto-dial poller. The poller discovers completion by
        // looking up call_logs, so waiting for another poll creates a race
        // where the UI/task can remain in "dialing" even though this call is
        // already finalized. Clearing the provider SID also makes this
        // idempotent: a later scheduler tick cannot treat the same call as
        // still active and re-process it.
        await db.patch("dialertasks", orgId, retryContext.taskId, {
          callResults,
          currentLeadId: null,
          currentProviderCallSid: null,
          currentProvider: null,
          currentCallStartedAt: null,
          autoDialStatus: task.autoDialEnabled ? "waiting" : "paused",
          nextDialAt: new Date(Date.now() + 3000).toISOString(),
        });
      }
    } catch (err) {
      log.error(`❌ [${provider}] Failed to update task ${retryContext.taskId} callResults for lead ${retryContext.leadId}:`, err.message);
    }
  }

  db.incrementAiMinutesUsed(orgId, durationSeconds).catch(err =>
    log.error(`❌ [${provider}] AI-minutes metering error:`, err.message)
  );
  db.incrementPhoneCharges(orgId, durationSeconds).catch(err =>
    log.error(`❌ [${provider}] Phone-charges metering error:`, err.message)
  );

  // Cost-track the post-call agents (sentiment, follow-up, workflow-
  // answers, summary — whichever actually ran for this call) as their own
  // "gemini-postcall" ai_session_usage row, priced against that AI cost
  // provider's rate (see platform/costProviders.js) separately from the
  // live voice session. A single start->record->finalize sequence, not
  // truly "live", since all the usage is already known post-hoc — reuses
  // the exact same tracked pipeline/schema the voice session uses rather
  // than a parallel one-off cost calculation. Fire-and-forget, same as
  // the metering calls above: usage tracking must never fail call
  // finalization.
  if (postCallInputTokens > 0 || postCallOutputTokens > 0) {
    geminiUsageTracker.startUsageSession({
      orgId, callId, provider: "post-call-agents", model: postCallAgents.MODEL, costProviderKey: "gemini-postcall",
    }).then(async (handle) => {
      if (!handle) return;
      await geminiUsageTracker.recordUsage(handle, { inputTokens: postCallInputTokens, outputTokens: postCallOutputTokens });
      await geminiUsageTracker.finalizeUsageSession(handle);
    }).catch(err => log.error(`❌ [${provider}] post-call-agents usage tracking error:`, err.message));
  }

  return { fullTranscript, mergedTranscriptLines };
}

module.exports = { finalizeCallRecord, mergeTranscriptLines, buildFullTranscript, uploadRecording, saveContactDetailsNow };
