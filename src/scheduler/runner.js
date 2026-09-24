"use strict";

const { schedules, callbackSchedules } = require("./definitions");
const { getLogger } = require("../observability/logger");
const log = getLogger("scheduler.runner");

const running = new Set();

function getSchedule(id) {
  return [...schedules, ...callbackSchedules].find((item) => item.id === id) || null;
}

async function runSchedule(id) {
  const schedule = getSchedule(id);
  if (!schedule) {
    const err = new Error(`Unknown schedule: ${id}`);
    err.code = "UNKNOWN_SCHEDULE";
    throw err;
  }

  if (running.has(id)) {
    const err = new Error(`Schedule is already running: ${id}`);
    err.code = "SCHEDULE_ALREADY_RUNNING";
    throw err;
  }

  running.add(id);
  const startedAt = Date.now();
  try {
    log.info(`Running schedule ${id}`);
    await schedule.run();
    return { id, durationMs: Date.now() - startedAt };
  } finally {
    running.delete(id);
  }
}

function listSchedules() {
  return schedules.map(({ id, expression }) => ({ id, expression, kind: "operational" }));
}

function listCallbackSchedules() {
  return callbackSchedules.map(({ id, expression }) => ({ id, expression, kind: "callback" }));
}

module.exports = { getSchedule, runSchedule, listSchedules, listCallbackSchedules };
