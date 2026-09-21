// src/queue/adapters/memoryQueueAdapter.js
//
// Custom in-process job queue: concurrency-limited execution, automatic
// retry (3 attempts with exponential backoff + jitter), a per-job-type
// circuit breaker so a clearly-down dependency stops being hammered
// mid-retry-storm, and a dead-letter store for jobs that exhaust their
// retries. Dead-lettered jobs are purged after 3 days, and get exactly
// one more attempt per day during a configurable "quiet hours" window —
// but ONLY when the live queue is completely idle, so a nightly
// dead-letter retry never competes with real traffic.
//
// Known limitation of this adapter specifically (not the queue interface):
// everything lives in process memory, so an in-flight job, a pending retry
// backoff timer, the circuit breaker's state, or the dead-letter store
// itself does NOT survive a process restart. That's an acceptable
// tradeoff for "protect Gemini from bursty concurrent post-call
// pipelines" today; if durability across restarts (or multi-process
// workers) is ever needed, swap in a persistent adapter (see
// src/queue/index.js) — nothing outside this file changes.

const { createCircuitBreaker, CircuitOpenError } = require("../circuitBreaker");
const { getLogger } = require("../../observability/logger");
const log = getLogger("queue.adapters.memoryQueueAdapter");

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 5_000;   // delay before attempt 2
const MAX_RETRY_DELAY_MS = 5 * 60_000; // cap for pathologically high attempt counts
const RETRY_JITTER_RATIO = 0.2;       // +/-20% jitter to avoid synchronized retry storms
const DEAD_LETTER_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const DEAD_LETTER_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // check twice an hour whether it's "quiet hours" + idle
const NIGHT_WINDOW = { startHour: 1, endHour: 4 }; // server-local time, 01:00-04:00

function nowIso() {
  return new Date().toISOString();
}

// Exponential backoff: doubles per failed attempt (5s, 10s, 20s, ...),
// capped, with jitter so many jobs failing at once don't all retry in
// the exact same instant and re-create the burst they just got hit by.
function computeBackoffMs(attemptNumber) {
  const exp = BASE_RETRY_DELAY_MS * (2 ** (attemptNumber - 1));
  const capped = Math.min(MAX_RETRY_DELAY_MS, exp);
  const jitterFactor = 1 + (Math.random() * 2 - 1) * RETRY_JITTER_RATIO; // 0.8x - 1.2x
  return Math.round(capped * jitterFactor);
}

function createMemoryQueueAdapter() {
  const registrations = new Map(); // type -> { handler, concurrency, active, waiting: Job[], breaker }
  const deadLetters = new Map();   // jobId -> { type, data, attempts, firstFailedAt, lastFailedAt, lastError }
  let jobSeq = 0;
  let lastDeadLetterRetryDate = null; // 'YYYY-MM-DD' — so the daily dead-letter retry only fires once per day
  let sweepTimer = null;

  function getRegistration(type) {
    const reg = registrations.get(type);
    if (!reg) throw new Error(`[queue] no processor registered for job type "${type}" — call process() before enqueue()`);
    return reg;
  }

  function totalActiveCount() {
    let n = 0;
    for (const reg of registrations.values()) n += reg.active;
    return n;
  }

  function pump(type) {
    const reg = registrations.get(type);
    if (!reg) return;
    while (reg.active < reg.concurrency && reg.waiting.length > 0) {
      const job = reg.waiting.shift();
      reg.active++;
      runJob(type, reg, job);
    }
  }

  async function runJob(type, reg, job) {
    try {
      // Routed through the circuit breaker: if it's OPEN, this throws
      // CircuitOpenError immediately without ever calling reg.handler —
      // failing fast instead of adding yet another doomed call on top of
      // a dependency that's already confirmed down.
      await (reg.breaker ? reg.breaker.execute(() => reg.handler(job.data)) : reg.handler(job.data));
    } catch (err) {
      job.attempts++;
      job.lastError = err.message;
      if (!job.firstFailedAt) job.firstFailedAt = nowIso();
      const circuitTag = err instanceof CircuitOpenError ? " [circuit open]" : "";
      log.error(`❌ [queue:${type}] job ${job.id} attempt ${job.attempts}/${MAX_ATTEMPTS} failed${circuitTag}: ${err.message}`);
      if (job.attempts < MAX_ATTEMPTS) {
        const delay = computeBackoffMs(job.attempts);
        setTimeout(() => {
          reg.waiting.push(job);
          pump(type);
        }, delay).unref?.();
      } else {
        log.error(`💀 [queue:${type}] job ${job.id} exhausted ${MAX_ATTEMPTS} attempts — moving to dead letter store (retained ${DEAD_LETTER_TTL_MS / 86400000}d, retried nightly while idle)`);
        deadLetters.set(job.id, {
          type,
          data: job.data,
          attempts: job.attempts,
          firstFailedAt: job.firstFailedAt,
          lastFailedAt: nowIso(),
          lastError: err.message,
        });
      }
    } finally {
      reg.active--;
      pump(type);
    }
  }

  function enqueue(type, data) {
    const reg = getRegistration(type);
    const job = { id: `job_${Date.now()}_${++jobSeq}`, data, attempts: 0, firstFailedAt: null, lastError: null };
    reg.waiting.push(job);
    pump(type);
    return job.id;
  }

  // opts.circuitBreaker: pass `false` to disable, or an options object
  // forwarded to createCircuitBreaker (failureThreshold, baseResetTimeoutMs,
  // maxResetTimeoutMs, halfOpenSuccessesToClose). Enabled by default —
  // it's cheap and protects every job type's downstream dependency without
  // extra wiring.
  function process(type, handler, opts = {}) {
    if (registrations.has(type)) throw new Error(`[queue] processor for "${type}" already registered`);
    const breaker = opts.circuitBreaker === false
      ? null
      : createCircuitBreaker(type, opts.circuitBreaker || {});
    registrations.set(type, {
      handler,
      concurrency: opts.concurrency ?? 5,
      active: 0,
      waiting: [],
      breaker,
    });
  }

  function isNightWindow(date = new Date()) {
    const h = date.getHours();
    return h >= NIGHT_WINDOW.startHour && h < NIGHT_WINDOW.endHour;
  }

  // "No load" is defined here as: nothing currently active across ANY
  // registered queue type. Simple and adapter-local — good enough to avoid
  // piling dead-letter retries on top of live traffic without needing an
  // external system-load signal.
  function sweepDeadLetters() {
    const now = Date.now();
    for (const [id, dl] of deadLetters) {
      if (now - new Date(dl.firstFailedAt).getTime() > DEAD_LETTER_TTL_MS) {
        log.warn(`🗑️ [queue] dead letter ${id} (${dl.type}) expired after ${DEAD_LETTER_TTL_MS / 86400000} days — discarding`);
        deadLetters.delete(id);
      }
    }
    if (deadLetters.size === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    if (lastDeadLetterRetryDate === today) return; // already attempted today
    if (!isNightWindow()) return;                  // not in the quiet-hours window
    if (totalActiveCount() > 0) return;             // live queues are busy — don't add to it

    lastDeadLetterRetryDate = today;
    log.info(`🌙 [queue] quiet hours + idle — retrying ${deadLetters.size} dead-lettered job(s)`);
    for (const [id, dl] of Array.from(deadLetters.entries())) {
      deadLetters.delete(id);
      try {
        enqueue(dl.type, dl.data); // fresh attempt counter — gets its own 3 tries again
      } catch (err) {
        log.error(`❌ [queue] failed to re-enqueue dead letter ${id}: ${err.message}`);
      }
    }
  }

  function start() {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweepDeadLetters, DEAD_LETTER_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  }

  function stop() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  }

  function isReady() { return true; }

  function getStats() {
    const stats = { deadLetterCount: deadLetters.size, deadLetters: Array.from(deadLetters.values()), queues: {} };
    for (const [type, reg] of registrations) {
      stats.queues[type] = {
        active: reg.active,
        waiting: reg.waiting.length,
        concurrency: reg.concurrency,
        circuitBreaker: reg.breaker ? reg.breaker.getState() : null,
      };
    }
    return stats;
  }

  return { enqueue, process, start, stop, isReady, getStats };
}

module.exports = { createMemoryQueueAdapter };
