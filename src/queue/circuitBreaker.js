const { getLogger } = require("../observability/logger");
const log = getLogger("queue.circuitBreaker");
// src/queue/circuitBreaker.js
//
// Generic circuit breaker: CLOSED (normal) -> OPEN (fail fast, don't even
// call the dependency) -> HALF_OPEN (allow a trial call) -> CLOSED or back
// to OPEN. Standalone and queue-agnostic — usable anywhere a flaky
// downstream dependency (Gemini, a third-party API, anything) needs
// protection from being hammered while it's clearly failing.
//
// The OPEN cooldown itself uses exponential backoff: each time a HALF_OPEN
// trial fails and the breaker re-trips, the next cooldown doubles (capped
// at maxResetTimeoutMs) instead of retrying a still-down dependency at a
// fixed interval forever. A trip counter resets the moment the breaker
// fully closes again.

class CircuitOpenError extends Error {
  constructor(name) {
    super(`[circuitBreaker:${name}] circuit is open — failing fast without calling the dependency`);
    this.name = "CircuitOpenError";
    this.circuitOpen = true;
  }
}

const STATE = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half-open" };

function createCircuitBreaker(name, {
  failureThreshold = 5,           // consecutive failures while CLOSED before tripping OPEN
  baseResetTimeoutMs = 30_000,    // first OPEN cooldown
  maxResetTimeoutMs = 10 * 60_000, // cap on the exponentially-growing cooldown
  halfOpenSuccessesToClose = 2,   // consecutive HALF_OPEN successes needed to fully close
} = {}) {
  let state = STATE.CLOSED;
  let consecutiveFailures = 0;
  let consecutiveHalfOpenSuccesses = 0;
  let openedAt = 0;
  let currentResetTimeoutMs = baseResetTimeoutMs;
  let tripCount = 0; // consecutive OPEN trips without ever fully closing — drives the exponential cooldown

  function close() {
    state = STATE.CLOSED;
    consecutiveFailures = 0;
    consecutiveHalfOpenSuccesses = 0;
    tripCount = 0;
    currentResetTimeoutMs = baseResetTimeoutMs;
    log.info(`🟢 [circuitBreaker:${name}] closed — dependency recovered`);
  }

  function trip() {
    state = STATE.OPEN;
    openedAt = Date.now();
    consecutiveHalfOpenSuccesses = 0;
    tripCount++;
    currentResetTimeoutMs = Math.min(maxResetTimeoutMs, baseResetTimeoutMs * (2 ** (tripCount - 1)));
    log.warn(`🔴 [circuitBreaker:${name}] OPEN — failing fast for ~${Math.round(currentResetTimeoutMs / 1000)}s (trip #${tripCount})`);
  }

  function noteSuccess() {
    if (state === STATE.HALF_OPEN) {
      consecutiveHalfOpenSuccesses++;
      if (consecutiveHalfOpenSuccesses >= halfOpenSuccessesToClose) close();
    } else if (state === STATE.CLOSED) {
      consecutiveFailures = 0;
    }
  }

  function noteFailure() {
    if (state === STATE.HALF_OPEN) {
      trip(); // failed the trial — reopen with a longer cooldown next time
      return;
    }
    if (state === STATE.CLOSED) {
      consecutiveFailures++;
      if (consecutiveFailures >= failureThreshold) trip();
    }
  }

  function canAttempt() {
    if (state === STATE.CLOSED) return true;
    if (state === STATE.OPEN) {
      if (Date.now() - openedAt >= currentResetTimeoutMs) {
        state = STATE.HALF_OPEN;
        consecutiveHalfOpenSuccesses = 0;
        log.info(`🟡 [circuitBreaker:${name}] half-open — allowing a trial request`);
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN: let trial attempts through
  }

  async function execute(fn) {
    if (!canAttempt()) throw new CircuitOpenError(name);
    try {
      const result = await fn();
      noteSuccess();
      return result;
    } catch (err) {
      noteFailure();
      throw err;
    }
  }

  function getState() {
    return { state, consecutiveFailures, tripCount, currentResetTimeoutMs, openedAt: openedAt || null };
  }

  return { execute, getState };
}

module.exports = { createCircuitBreaker, CircuitOpenError, STATE };
