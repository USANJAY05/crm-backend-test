// Durable RabbitMQ queue adapter.
//
// This implements the same queue contract as the memory adapter. Business
// logic must never import amqplib directly. Set QUEUE_PROVIDER=rabbitmq to
// use it; switching providers only changes configuration.
const amqp = require("amqplib");
const { createCircuitBreaker, CircuitOpenError } = require("../circuitBreaker");
const { getLogger } = require("../../observability/logger");
const log = getLogger("queue.adapters.rabbitMqQueueAdapter");

const MAX_ATTEMPTS = Number(process.env.QUEUE_MAX_ATTEMPTS || 3);
const BASE_RETRY_DELAY_MS = Number(process.env.QUEUE_RETRY_BASE_MS || 5000);
const MAX_RETRY_DELAY_MS = Number(process.env.QUEUE_RETRY_MAX_MS || 5 * 60 * 1000);
const RETRY_JITTER_RATIO = 0.2;
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "crm.jobs";
const PREFIX = process.env.RABBITMQ_QUEUE_PREFIX || "crm";

function backoff(attempt) {
  const exp = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
  return Math.round(exp * (1 + (Math.random() * 2 - 1) * RETRY_JITTER_RATIO));
}

function safeName(type) {
  return String(type).replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function createRabbitMqQueueAdapter() {
  const registrations = new Map();
  const pendingPublishes = [];
  const publisherSetup = new Map();
  let publisherChannel = null;
  let connection = null;
  let connectionPromise = null;
  let stopped = false;
  let sequence = 0;
  let reconnectTimer = null;
  let started = false;

  async function connect() {
    if (connection) return connection;
    if (connectionPromise) return connectionPromise;
    const url = process.env.RABBITMQ_URL || "amqp://rabbitmq:5672";
    connectionPromise = amqp.connect(url).then(async conn => {
      connection = conn;
      conn.on("error", err => log.error(`RabbitMQ connection error: ${err.message}`));
      conn.on("close", () => {
        connection = null;
        publisherChannel = null;
        connectionPromise = null;
        for (const reg of registrations.values()) reg.channel = null;
        if (!stopped && !reconnectTimer) {
          log.warn("RabbitMQ connection closed; scheduling consumer reconnect");
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            start().catch(err => log.error(`RabbitMQ reconnect failed: ${err.message}`));
          }, 5000);
          reconnectTimer.unref?.();
        }
      });
      return conn;
    }).catch(err => {
      connectionPromise = null;
      throw err;
    });
    return connectionPromise;
  }

  async function ensurePublisher() {
    if (publisherChannel) return publisherChannel;
    const conn = await connect();
    if (!publisherChannel) publisherChannel = await conn.createConfirmChannel();
    await publisherChannel.assertExchange(EXCHANGE, "direct", { durable: true });
    return publisherChannel;
  }

  async function publishConfirmed(channel, queue, job) {
    const body = Buffer.from(JSON.stringify(job));
    await new Promise((resolve, reject) => {
      try {
        channel.sendToQueue(queue, body, {
          persistent: true,
          contentType: "application/json",
        }, err => err ? reject(err) : resolve());
      } catch (err) {
        reject(err);
      }
    });
  }

  async function publishOnly(type, job) {
    const channel = await ensurePublisher();
    const name = safeName(type);
    const mainQueue = `${PREFIX}.${name}`;
    const routingKey = name;
    await channel.assertQueue(mainQueue, { durable: true });
    await channel.bindQueue(mainQueue, EXCHANGE, routingKey);
    await publishConfirmed(channel, mainQueue, job);
  }

  async function setupRegistration(type, reg) {
    if (reg.setupPromise) return reg.setupPromise;
    reg.setupPromise = (async () => {
    const conn = await connect();
    if (stopped) return;
    const channel = await conn.createConfirmChannel();
    reg.channel = channel;

    const name = safeName(type);
    const mainQueue = `${PREFIX}.${name}`;
    const deadQueue = `${PREFIX}.${name}.dead`;
    const routingKey = name;

    await channel.assertExchange(EXCHANGE, "direct", { durable: true });
    await channel.assertQueue(mainQueue, { durable: true });
    await channel.assertQueue(deadQueue, { durable: true });
    await channel.bindQueue(mainQueue, EXCHANGE, routingKey);
    await channel.prefetch(reg.concurrency);

    reg.mainQueue = mainQueue;
    reg.retryQueue = null;
    reg.deadQueue = deadQueue;

    await channel.consume(mainQueue, async msg => {
      if (!msg) return;
      reg.active++;
      let job;
      try {
        job = JSON.parse(msg.content.toString("utf8"));
        await (reg.breaker ? reg.breaker.execute(() => reg.handler(job.data)) : reg.handler(job.data));
        channel.ack(msg);
      } catch (err) {
        const attempt = Number(job?.attempts || 0) + 1;
        const jobId = job?.id || `unknown-${Date.now()}`;
        const next = { ...(job || { id: jobId, data: null }), attempts: attempt };
        const circuitTag = err instanceof CircuitOpenError ? " [circuit open]" : "";
        log.error(`❌ [queue:${type}] job ${jobId} attempt ${attempt}/${MAX_ATTEMPTS} failed${circuitTag}: ${err.message}`);

        try {
          if (attempt < MAX_ATTEMPTS) {
            // Use one durable TTL queue per delay bucket. A single TTL queue
            // suffers from head-of-line blocking when a long-delay message is
            // ahead of a shorter-delay message. Each bucket dead-letters back
            // to the main exchange when its TTL expires.
            const delayMs = backoff(attempt);
            const retryQueue = `${PREFIX}.${name}.retry.${delayMs}`;
            await channel.assertQueue(retryQueue, {
              durable: true,
              arguments: {
                "x-message-ttl": delayMs,
                "x-dead-letter-exchange": EXCHANGE,
                "x-dead-letter-routing-key": routingKey,
              },
            });
            await publishConfirmed(channel, retryQueue, next);
          } else {
            next.lastError = err.message;
            next.failedAt = new Date().toISOString();
            await publishConfirmed(channel, deadQueue, next);
            log.error(`💀 [queue:${type}] job ${jobId} exhausted ${MAX_ATTEMPTS} attempts; moved to ${deadQueue}`);
          }
          channel.ack(msg);
        } catch (publishErr) {
          // Keep the original message in RabbitMQ if we could not persist the
          // retry/dead-letter copy. It will be redelivered after recovery.
          log.error(`❌ [queue:${type}] could not persist failed job ${jobId}: ${publishErr.message}`);
          channel.nack(msg, false, true);
        }
      } finally {
        reg.active--;
      }
    }, { noAck: false });
    })().catch(err => {
      reg.channel = null;
      reg.setupPromise = null;
      throw err;
    });
    return reg.setupPromise;
  }

  function enqueue(type, data) {
    const reg = registrations.get(type);
    const jobId = `job_${Date.now()}_${++sequence}`;
    const job = { id: jobId, data, attempts: 0, enqueuedAt: new Date().toISOString() };

    // Scheduler processes are publishers only. They do not register workers,
    // so they must still be able to publish a job type to a durable RabbitMQ
    // queue. Worker processes use the registration path below.
    if (!reg) {
      if (!started) {
        pendingPublishes.push({ type, job });
        return jobId;
      }
      publishOnly(type, job).catch(err => {
        log.error(`❌ [queue:${type}] publisher-only enqueue failed: ${err.message}`);
        pendingPublishes.push({ type, job });
      });
      return jobId;
    }

    if (!reg.channel) {
      pendingPublishes.push({ type, job });
      return jobId;
    }

    publishConfirmed(reg.channel, reg.mainQueue, job).catch(err => {
      log.error(`❌ [queue:${type}] publish confirm failed: ${err.message}`);
      pendingPublishes.push({ type, job });
    });
    return jobId;
  }

  function process(type, handler, opts = {}) {
    if (registrations.has(type)) throw new Error(`[queue] processor for "${type}" already registered`);
    const reg = {
      handler,
      concurrency: opts.concurrency ?? 5,
      active: 0,
      breaker: opts.circuitBreaker === false ? null : createCircuitBreaker(type, opts.circuitBreaker || {}),
      channel: null,
      mainQueue: null,
      retryQueue: null,
      deadQueue: null,
      setupPromise: null,
    };
    registrations.set(type, reg);
    if (started) setupRegistration(type, reg).catch(err => log.error(`RabbitMQ registration failed for ${type}: ${err.message}`));
  }

  async function start() {
    stopped = false;
    started = true;
    try {
      await connect();
      for (const [type, reg] of registrations) {
        if (!reg.channel) await setupRegistration(type, reg);
      }
    } catch (err) {
      if (!stopped && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          start().catch(e => log.error(`RabbitMQ reconnect failed: ${e.message}`));
        }, 5000);
        reconnectTimer.unref?.();
      }
      throw err;
    }
    const pending = pendingPublishes.splice(0);
    for (const item of pending) {
      const reg = registrations.get(item.type);
      if (reg?.channel) {
        await publishConfirmed(reg.channel, reg.mainQueue, item.job);
      } else {
        try { await publishOnly(item.type, item.job); }
        catch (err) { pendingPublishes.push(item); log.error(`❌ [queue:${item.type}] pending publish failed: ${err.message}`); }
      }
    }
  }

  async function stop() {
    stopped = true;
    started = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    for (const reg of registrations.values()) {
      try { await reg.channel?.close(); } catch (_) {}
    }
    try { await publisherChannel?.close(); } catch (_) {}
    publisherChannel = null;
    try { await connection?.close(); } catch (_) {}
    connection = null;
    connectionPromise = null;
  }

  function isReady() { return Boolean(connection && started && !stopped); }

  function getStats() {
    const queues = {};
    for (const [type, reg] of registrations) {
      queues[type] = {
        active: reg.active,
        waiting: null,
        concurrency: reg.concurrency,
        circuitBreaker: reg.breaker ? reg.breaker.getState() : null,
        durable: true,
        provider: "rabbitmq",
      };
    }
    return { deadLetterCount: null, deadLetters: [], queues: Object.fromEntries(Object.entries(queues)) };
  }

  return { enqueue, process, start, stop, isReady, getStats };
}

module.exports = { createRabbitMqQueueAdapter };
