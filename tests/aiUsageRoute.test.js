// tests/aiUsageRoute.test.js
//
// HTTP-level tests for GET /api/ai-usage* — verifies the route only ever
// queries with the ORG ID FROM THE AUTHENTICATED REQUEST CONTEXT
// (req.orgId, set by requireAuth), never from a client-supplied value,
// and that the route wiring is correct end to end.

jest.mock("../src/middleware/auth", () => ({
  // Stand-in for the real requireAuth: reads org/admin id from test
  // headers instead of a JWT, but the SHAPE (req.orgId/req.userId set
  // server-side before the handler runs) is identical to production —
  // that's the exact thing this test suite is checking routes respect.
  requireAuth: (req, res, next) => {
    req.orgId = req.headers["x-test-org-id"] || null;
    req.userId = req.headers["x-test-user-id"] || null;
    if (!req.orgId) return res.status(401).json({ error: "Unauthorized" });
    next();
  },
}));

jest.mock("../src/db/repository", () => ({
  list: jest.fn(async (entity, orgId) => ({ rows: [{ id: "row-1", orgId }], total: 1 })),
  getAiUsageSummary: jest.fn(async (orgId) => ({ sessionCount: 1, callCount: 1, totalTokens: 100, totalCost: 0.01, currency: "USD", orgId })),
  getAiUsageByAdmin: jest.fn(async (orgId) => ([{ adminId: "admin-1", sessionCount: 1, totalTokens: 100, totalCost: 0.01, orgId }])),
}));

const express = require("express");
const request = require("supertest");
const db = require("../src/db/repository");
const aiUsageRouter = require("../src/routes/aiUsage");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ai-usage", aiUsageRouter);
  return app;
}

describe("GET /api/ai-usage", () => {
  test("rejects an unauthenticated request", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/ai-usage");
    expect(res.status).toBe(401);
  });

  test("scopes the query to the authenticated request's org, never a client-supplied one", async () => {
    const app = buildApp();
    await request(app)
      .get("/api/ai-usage?org_id=someone-elses-org") // a query param an attacker might try — must be ignored
      .set("x-test-org-id", "org-real")
      .set("x-test-user-id", "user-1")
      .expect(200);

    expect(db.list).toHaveBeenCalledWith("aisessionusage", "org-real", {});
  });

  test("two different authenticated orgs get two independently-scoped queries", async () => {
    const app = buildApp();
    await request(app).get("/api/ai-usage").set("x-test-org-id", "org-a").expect(200);
    await request(app).get("/api/ai-usage").set("x-test-org-id", "org-b").expect(200);

    const orgsQueried = db.list.mock.calls.map((call) => call[1]);
    expect(orgsQueried).toContain("org-a");
    expect(orgsQueried).toContain("org-b");
    expect(orgsQueried[0]).not.toBe(orgsQueried[1]);
  });
});

describe("GET /api/ai-usage/summary", () => {
  test("marks every figure as an estimate, never the authoritative billed amount", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/ai-usage/summary").set("x-test-org-id", "org-real").expect(200);
    expect(res.body.estimated).toBe(true);
  });

  test("is scoped to the authenticated org", async () => {
    const app = buildApp();
    await request(app).get("/api/ai-usage/summary").set("x-test-org-id", "org-z").expect(200);
    expect(db.getAiUsageSummary).toHaveBeenCalledWith("org-z", expect.any(Object));
  });
});

describe("GET /api/ai-usage/by-admin", () => {
  test("is scoped to the authenticated org", async () => {
    const app = buildApp();
    await request(app).get("/api/ai-usage/by-admin").set("x-test-org-id", "org-z").expect(200);
    expect(db.getAiUsageByAdmin).toHaveBeenCalledWith("org-z", expect.any(Object));
  });
});
