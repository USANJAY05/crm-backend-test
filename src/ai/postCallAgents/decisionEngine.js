// Deterministic transcript signals used to validate post-call AI decisions.
// The transcript, not sentiment/summary, is the source of truth for caller intent.

function callerTurns(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .filter((line) => /^Caller\s*:/i.test(line))
    .map((line) => line.replace(/^Caller\s*:\s*/i, "").trim())
    .filter(Boolean);
}

function deriveTranscriptSignals(transcript) {
  const turns = callerTurns(transcript);
  const callerText = turns.join(" ");
  const callerSpoke = turns.length > 0 && callerText.split(/\s+/).filter(Boolean).length > 0;

  // These phrases represent explicit caller intent to continue the
  // conversation later. Keep this list intentionally broad; the model still
  // handles exact time extraction and semantic enquiry detection.
  const explicitCallback = /\b(?:call(?: me)? back|callback|call again|ring me|contact me later|speak later|call me again|talk later|reach me later)\b/i.test(callerText);
  const busyRequest = /\b(?:i['’]?m|i am|we are|we're|currently)?\\s*busy\b|\bnot a good time\b|\bcan(?:not|'t) talk\b|\bunable to talk\b|\bcan't speak\b|\bcannot speak\b/i.test(callerText);

  // Only Caller turns are inspected, so an Agent saying "I can call you at
  // 5 PM" cannot accidentally become a scheduled caller time.
  const callerSuppliedTime = /\b(?:in\\s+\\d+\\s*(?:minutes?|mins?|hours?|hrs?)|(?:today|tomorrow|tonight|morning|afternoon|evening)|at\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|\b\\d{1,2}\\s*(?:am|pm)\b)\b/i.test(callerText);

  return { turns, callerText, callerSpoke, explicitCallback, busyRequest, callerSuppliedTime };
}

module.exports = { callerTurns, deriveTranscriptSignals };
