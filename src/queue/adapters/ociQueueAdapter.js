// OCI Queue adapter.
//
// OCI Queue is a managed durable queue. It provides at-least-once delivery,
// visibility timeouts and a server-side DLQ. The adapter keeps the existing
// queue facade used by the CRM and maps each job type to its own OCI queue OCID
// when OCI_QUEUE_MAP is provided, or to OCI_QUEUE_OCID as a shared queue.
//
// Authentication:
//   OCI_AUTH_MODE=instance_principal  -> recommended on an OCI Compute VM
//   OCI_AUTH_MODE=config_file         -> local development / non-OCI hosts

const oci = require('oci-sdk');
const common = require('oci-common');
const { createCircuitBreaker, CircuitOpenError } = require('../circuitBreaker');
const { getLogger } = require('../../observability/logger');
const log = getLogger('queue.adapters.ociQueueAdapter');

const MAX_ATTEMPTS = Number(process.env.QUEUE_MAX_ATTEMPTS || 3);
const VISIBILITY_SECONDS = Number(process.env.OCI_QUEUE_VISIBILITY_SECONDS || 300);
const POLL_TIMEOUT_SECONDS = Number(process.env.OCI_QUEUE_POLL_TIMEOUT_SECONDS || 20);
const POLL_LIMIT = Math.min(20, Math.max(1, Number(process.env.OCI_QUEUE_POLL_LIMIT || 10)));
const DEFAULT_QUEUE_ID = process.env.OCI_QUEUE_OCID || '';
const QUEUE_MAP = parseQueueMap(process.env.OCI_QUEUE_MAP || '');

function parseQueueMap(raw) {
  const map = {};
  for (const part of String(raw).split(',')) {
    const [type, queueId] = part.split('=').map(v => v?.trim());
    if (type && queueId) map[type] = queueId;
  }
  return map;
}

function queueIdFor(type) {
  const id = QUEUE_MAP[type] || DEFAULT_QUEUE_ID;
  if (!id) throw new Error(`[queue] no OCI queue configured for job type "${type}"`);
  return id;
}

function authProvider() {
  const mode = String(process.env.OCI_AUTH_MODE || 'instance_principal').toLowerCase();
  if (mode === 'instance_principal') {
    return common.InstancePrincipalsAuthenticationDetailsProvider.builder();
  }
  if (mode === 'config_file') {
    return new common.ConfigFileAuthenticationDetailsProvider(
      process.env.OCI_CONFIG_FILE || undefined,
      process.env.OCI_CONFIG_PROFILE || 'DEFAULT'
    );
  }
  throw new Error(`[queue] unsupported OCI_AUTH_MODE="${mode}"`);
}

function createClient() {
  const client = new oci.queue.QueueClient({ authenticationDetailsProvider: authProvider() });
  if (process.env.OCI_QUEUE_REGION) client.region = process.env.OCI_QUEUE_REGION;
  if (process.env.OCI_QUEUE_ENDPOINT) client.endpoint = process.env.OCI_QUEUE_ENDPOINT;
  return client;
}

function backoff(attempt) {
  const base = Number(process.env.QUEUE_RETRY_BASE_MS || 5000);
  const max = Number(process.env.QUEUE_RETRY_MAX_MS || 5 * 60 * 1000);
  const exp = Math.min(max, base * (2 ** Math.max(0, attempt - 1)));
  return Math.round(exp * (0.8 + Math.random() * 0.4));
}

function createOciQueueAdapter() {
  const registrations = new Map();
  const pendingPublishes = [];
  let client = null;
  let started = false;
  let stopped = false;
  let sequence = 0;

  function getClient() {
    if (!client) client = createClient();
    return client;
  }

  async function publish(type, job) {
    const queueId = queueIdFor(type);
    await getClient().putMessages({
      queueId,
      putMessagesDetails: {
        messages: [{ content: JSON.stringify(job) }],
      },
    });
  }

  async function drainPending() {
    if (!started) return;
    while (pendingPublishes.length) {
      const item = pendingPublishes.shift();
      try {
        await publish(item.type, item.job);
      } catch (err) {
        pendingPublishes.unshift(item);
        log.error(`OCI Queue pending publish failed: ${err.message}`);
        break;
      }
    }
  }

  async function consume(type, reg) {
    const queueId = queueIdFor(type);
    while (!stopped) {
      try {
        const response = await getClient().getMessages({
          queueId,
          limit: Math.min(POLL_LIMIT, reg.concurrency),
          timeoutInSeconds: POLL_TIMEOUT_SECONDS,
          visibilityInSeconds: VISIBILITY_SECONDS,
        });
        const messages = response.items || response.getMessages?.items || [];
        if (!messages.length) continue;

        await Promise.all(messages.map(async message => {
          reg.active++;
          try {
            let job;
            try {
              job = JSON.parse(message.content);
            } catch {
              job = { id: `invalid-${Date.now()}`, data: null, attempts: MAX_ATTEMPTS, invalidPayload: true };
            }

            try {
              await (reg.breaker ? reg.breaker.execute(() => reg.handler(job.data)) : reg.handler(job.data));
              await getClient().deleteMessage({ queueId, messageReceipt: message.receipt });
            } catch (err) {
              const attempts = Number(job.attempts || 0) + 1;
              const jobId = job.id || `unknown-${Date.now()}`;
              if (attempts >= MAX_ATTEMPTS) {
                // OCI Queue's configured delivery-attempt limit moves messages
                // to its server-side DLQ. Do not delete a failed message here.
                log.error(`💀 [queue:${type}] job ${jobId} exhausted ${MAX_ATTEMPTS} attempts; OCI Queue will handle DLQ delivery`);
                return;
              }

              // Keep the message un-deleted so OCI Queue redelivers it after
              // visibility expires. We encode the next attempt in the payload
              // only when the handler itself republishes; otherwise delivery
              // count remains the source of truth on OCI.
              log.error(`❌ [queue:${type}] job ${jobId} failed; delivery will retry after visibility timeout: ${err.message}`);
              if (err instanceof CircuitOpenError) await new Promise(r => setTimeout(r, Math.min(backoff(attempts), VISIBILITY_SECONDS * 1000)));
            }
          } finally {
            reg.active--;
          }
        }));
      } catch (err) {
        if (stopped) break;
        log.error(`OCI Queue consumer ${type} failed: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  function enqueue(type, data) {
    const job = {
      id: `job_${Date.now()}_${++sequence}`,
      data,
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    if (!started) {
      pendingPublishes.push({ type, job });
      return job.id;
    }
    publish(type, job).catch(err => {
      log.error(`❌ [queue:${type}] OCI Queue publish failed: ${err.message}`);
      pendingPublishes.push({ type, job });
    });
    return job.id;
  }

  function process(type, handler, opts = {}) {
    if (registrations.has(type)) throw new Error(`[queue] processor for "${type}" already registered`);
    const reg = {
      handler,
      concurrency: opts.concurrency ?? 5,
      active: 0,
      breaker: opts.circuitBreaker === false ? null : createCircuitBreaker(type, opts.circuitBreaker || {}),
    };
    registrations.set(type, reg);
    if (started) consume(type, reg).catch(err => log.error(`OCI Queue registration failed for ${type}: ${err.message}`));
  }

  async function start() {
    if (started) return;
    stopped = false;
    started = true;
    // Validate credentials/configuration early.
    getClient();
    await drainPending();
    for (const [type, reg] of registrations) consume(type, reg).catch(err => log.error(`OCI Queue consumer failed for ${type}: ${err.message}`));
  }

  async function stop() {
    stopped = true;
    started = false;
    try { client?.close?.(); } catch (_) {}
    client = null;
  }

  function isReady() { return Boolean(client && started && !stopped); }

  function getStats() {
    const queues = {};
    for (const [type, reg] of registrations) {
      queues[type] = {
        active: reg.active,
        waiting: null,
        concurrency: reg.concurrency,
        circuitBreaker: reg.breaker ? reg.breaker.getState() : null,
        durable: true,
        provider: 'oci_queue',
        queueId: queueIdFor(type),
      };
    }
    return { deadLetterCount: null, deadLetters: [], queues };
  }

  return { enqueue, process, start, stop, isReady, getStats };
}

module.exports = { createOciQueueAdapter };
