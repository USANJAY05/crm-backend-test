// tests/geminiUsageTracker.test.js
//
// Unit tests against an in-memory fake of src/db/repository.js's
// ai_session_usage functions — no live MySQL connection required, so
// this runs the same in CI as on a laptop. What's under test is the
// tracker's OWN logic (accumulation, idempotency, cost finalization),
// not the database layer itself.

jest.mock("../src/db/repository", () => {
  const store = new Map();
  let idCounter = 0;
  return {
    __store: store,
    __reset: () => { store.clear(); idCounter = 0; },
    create: jest.fn(async (entity, orgId, obj) => {
      const id = `usage-${++idCounter}`;
      const row = { id, orgId, ...obj };
      store.set(id, row);
      return row;
    }),
    patch: jest.fn(async (entity, orgId, id, patchObj) => {
      const existing = store.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patchObj };
      store.set(id, updated);
      return updated;
    }),
    getAiSessionUsage: jest.fn(async (id, orgId) => {
      const row = store.get(id);
      return row && row.orgId === orgId ? row : null;
    }),
  };
});

jest.mock("../src/ai/googleCloudProjectProvider", () => ({
  getGoogleCloudProjectProvider: () => ({
    resolveProject: async () => ({ projectId: "test-project", location: "us-central1", source: "shared" }),
  }),
}));

const db = require("../src/db/repository");
const tracker = require("../src/ai/geminiUsageTracker");

beforeEach(() => {
  db.__reset();
  jest.clearAllMocks();
});

describe("startUsageSession", () => {
  test("creates a usage record associated with the call, session, org, and admin", async () => {
    const handle = await tracker.startUsageSession({
      orgId: "org-1", adminId: "admin-1", callId: "call-1", sessionId: "stream-1",
      provider: "vobiz", model: "gemini-live-2.5-flash-native-audio",
    });
    expect(handle).not.toBeNull();
    const row = db.__store.get(handle.id);
    expect(row.callId).toBe("call-1");
    expect(row.sessionId).toBe("stream-1");
    expect(row.orgId).toBe("org-1");
    expect(row.adminId).toBe("admin-1");
    expect(row.provider).toBe("vobiz");
    expect(row.model).toBe("gemini-live-2.5-flash-native-audio");
    expect(row.status).toBe("in_progress");
    expect(row.gcpProjectId).toBe("test-project");
    expect(row.sessionStartedAt).toBeTruthy();
  });

  test("returns null without throwing when orgId is missing (never blocks the actual call)", async () => {
    const handle = await tracker.startUsageSession({ orgId: null, callId: "call-2", provider: "vobiz", model: "m" });
    expect(handle).toBeNull();
  });
});

describe("recordUsage — cumulative usage handling", () => {
  test("keeps the maximum cumulative value seen instead of summing repeated events", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-3", provider: "vobiz", model: "m" });
    await tracker.recordUsage(handle, { inputTokens: 100, outputTokens: 50 });
    await tracker.recordUsage(handle, { inputTokens: 250, outputTokens: 120 });
    // A later event reporting a LOWER cumulative total (out-of-order
    // delivery, or a stale retransmit) must not regress the stored value.
    await tracker.recordUsage(handle, { inputTokens: 200, outputTokens: 90 });

    const row = db.__store.get(handle.id);
    expect(row.inputTokens).toBe(250);
    expect(row.outputTokens).toBe(120);
    expect(row.totalTokens).toBe(370);
  });

  test("is a no-op (no extra write) when the reported cumulative total hasn't changed", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-3b", provider: "vobiz", model: "m" });
    await tracker.recordUsage(handle, { inputTokens: 100, outputTokens: 50 });
    const patchCallsAfterFirst = db.patch.mock.calls.length;
    await tracker.recordUsage(handle, { inputTokens: 100, outputTokens: 50 }); // identical repeat
    expect(db.patch.mock.calls.length).toBe(patchCallsAfterFirst);
  });

  test("is silently ignored after the session is finalized (does not reopen a closed record)", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-3c", provider: "vobiz", model: "m" });
    await tracker.finalizeUsageSession(handle, { status: "completed" });
    const patchCallsAfterFinalize = db.patch.mock.calls.length;
    await tracker.recordUsage(handle, { inputTokens: 999, outputTokens: 999 });
    expect(db.patch.mock.calls.length).toBe(patchCallsAfterFinalize);
    expect(db.__store.get(handle.id).inputTokens).toBe(0);
  });
});

describe("finalizeUsageSession", () => {
  test("computes duration and estimated cost, and marks the session completed", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-4", provider: "vobiz", model: "gemini-live-2.5-flash-native-audio" });
    await tracker.recordUsage(handle, { inputTokens: 1_000_000, outputTokens: 1_000_000 });

    const finalized = await tracker.finalizeUsageSession(handle, { status: "completed" });

    expect(finalized.status).toBe("completed");
    expect(finalized.totalTokens).toBe(2_000_000);
    expect(finalized.totalCost).toBeCloseTo(15.0, 6);
    expect(finalized.currency).toBe("USD");
    expect(finalized.pricingVersion).toBeTruthy();
    expect(finalized.sessionEndedAt).toBeTruthy();
    expect(typeof finalized.durationSeconds).toBe("number");
    expect(finalized.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  test("duplicate finalization does not create a duplicate record or recompute cost", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-5", provider: "vobiz", model: "gemini-live-2.5-flash-native-audio" });
    await tracker.recordUsage(handle, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    await tracker.finalizeUsageSession(handle, { status: "completed" });

    const patchCallsAfterFirstFinalize = db.patch.mock.calls.length;
    // A second finalize call (e.g. two close handlers both firing) must
    // not overwrite the record — including not flipping a successfully
    // completed session to "failed".
    const secondResult = await tracker.finalizeUsageSession(handle, { status: "failed", errorMessage: "should be ignored" });

    expect(db.patch.mock.calls.length).toBe(patchCallsAfterFirstFinalize); // no additional write
    expect(secondResult.status).toBe("completed");
    expect(db.__store.size).toBe(1); // still exactly one row for this session
  });
});

describe("failUsageSession", () => {
  test("records failure status, error code, and message, and still finalizes duration/cost from whatever usage was captured", async () => {
    const handle = await tracker.startUsageSession({ orgId: "org-1", callId: "call-6", provider: "vobiz", model: "gemini-live-2.5-flash-native-audio" });
    await tracker.recordUsage(handle, { inputTokens: 500_000, outputTokens: 0 });

    const failed = await tracker.failUsageSession(handle, { errorCode: "1011", errorMessage: "Internal error occurred" });

    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("1011");
    expect(failed.errorMessage).toBe("Internal error occurred");
    expect(failed.inputTokens).toBe(500_000);
    expect(failed.totalCost).toBeGreaterThan(0); // partial usage still costed, not discarded
  });
});

describe("tracking never breaks the caller", () => {
  test("every tracker function accepts a null handle without throwing", async () => {
    await expect(tracker.recordUsage(null, { inputTokens: 1, outputTokens: 1 })).resolves.toBeUndefined();
    await expect(tracker.finalizeUsageSession(null)).resolves.toBeNull();
    await expect(tracker.failUsageSession(null)).resolves.toBeNull();
    await expect(tracker.attachProviderSessionId(null, "x")).resolves.toBeUndefined();
  });
});
