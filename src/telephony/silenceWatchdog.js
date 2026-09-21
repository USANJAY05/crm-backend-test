// src/telephony/silenceWatchdog.js
//
// Provider-agnostic backstop for a call the remote party has already ended,
// when the provider's own end-of-call signal (status/hangup webhook, or the
// media-stream WebSocket closing) doesn't arrive promptly or at all. Every
// provider proxy already receives inbound audio frames to feed Gemini — this
// watches the time since the last one arrived and, after a nudge goes
// unanswered too, treats the call as over. Without this, a webhook that
// never fires (wrong provider-side URL, a field name mismatch, delivery
// failure) left the outbound dialer's auto-dial-next-target stalled
// indefinitely on a call the customer had already hung up, since nothing
// else was watching for "no one is actually there anymore".
function createSilenceWatchdog({ nudgeMs = 10000, hangupMs = 30000, intervalMs = 3000, onNudge, onHangup }) {
  let lastAudioAt = Date.now();
  let nudgeSent = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const silentMs = Date.now() - lastAudioAt;

    if (silentMs >= hangupMs) {
      stopped = true;
      clearInterval(timer);
      Promise.resolve(onHangup?.(silentMs)).catch(() => {});
      return;
    }

    if (silentMs >= nudgeMs && !nudgeSent) {
      nudgeSent = true;
      Promise.resolve(onNudge?.(silentMs)).catch(() => {});
    }
  }, intervalMs);

  return {
    // Call this whenever an inbound audio frame arrives.
    recordAudio() {
      lastAudioAt = Date.now();
      nudgeSent = false;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// Returns true if a 16-bit PCM buffer has no sample above `threshold`
// amplitude — i.e. it's silence or dead air, not real speech. Some
// telephony platforms keep pumping empty/comfort-noise frames down a media
// stream even after the far end has hung up (e.g. Vobiz's
// `keepCallAlive="true"` Stream option decouples the WebSocket's lifetime
// from the call's), so "a frame arrived" alone is not proof the caller is
// still there. Without this check, recordAudio() being called on every
// frame regardless of content would reset the watchdog forever and the
// hangup timeout could never fire.
function isSilentPcm16(buffer, threshold = 150) {
  if (!buffer || buffer.length < 2) return true;
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    if (Math.abs(buffer.readInt16LE(i)) > threshold) return false;
  }
  return true;
}

module.exports = { createSilenceWatchdog, isSilentPcm16 };
