// src/routes/dashboard.js — /api/dashboard/metrics

const { safeErrorMessage } = require("../observability/safeError");
const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");
const db = require("../db/repository");
const objectsEngine = require("../crm/objectsEngine");

router.get("/metrics", requireAuth, async (req, res) => {
  try {
    const [leads, loans, callLogs] = await Promise.all([
      db.list("leads", req.orgId),
      db.list("loans", req.orgId),
      db.list("calllogs", req.orgId)
    ]);

    // Portfolio trend: last 6 months of loan disbursements.
    const now = new Date();
    const monthKeys = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const monthTotals = Object.fromEntries(monthKeys.map(k => [k, { totalDisbursed: 0, loanCount: 0 }]));
    for (const loan of loans) {
      if (!loan.createdAt) continue;
      const d = new Date(loan.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (monthTotals[key]) { monthTotals[key].totalDisbursed += Number(loan.amount) || 0; monthTotals[key].loanCount++; }
    }
    const portfolioTrend = monthKeys.map(month => ({ month, ...monthTotals[month] }));

    const sourceCounts = {};
    for (const lead of leads) sourceCounts[lead.source || "Unknown"] = (sourceCounts[lead.source || "Unknown"] || 0) + 1;
    const channelPerformance = Object.entries(sourceCounts).map(([source, count]) => ({ source, count }));

    const todayKey = new Date().toISOString().slice(0, 10);
    const callsToday = callLogs.filter(c => c.createdAt && String(c.createdAt).slice(0, 10) === todayKey).length;

    const analyzed = callLogs.filter(c => c.sentiment && c.sentiment !== "Unknown");
    const positiveSentimentPct = analyzed.length
      ? Math.round((analyzed.filter(c => c.sentiment === "Positive").length / analyzed.length) * 100)
      : null;

    const objectMetrics = await objectsEngine.getDashboardMetrics(req.orgId);

    const leadById = Object.fromEntries(leads.map(l => [l.id, l]));
    const latestCallByLead = {};
    for (const call of callLogs) {
      if (!call.leadId || !call.createdAt) continue;
      const existing = latestCallByLead[call.leadId];
      if (!existing || new Date(call.createdAt) > new Date(existing.createdAt)) latestCallByLead[call.leadId] = call;
    }
    const topInterestedClients = Object.values(latestCallByLead)
      .filter(call => call.sentiment === "Positive")
      .map(call => ({ leadId: call.leadId, name: leadById[call.leadId]?.name || call.leadName || "Unknown", phone: leadById[call.leadId]?.phone || null, amountRequested: leadById[call.leadId]?.amountRequested ?? null, score: leadById[call.leadId]?.score ?? null, intent: call.intent || null, lastCallSummary: call.summary || null, lastCallAt: call.createdAt }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    res.json({ portfolioTrend, channelPerformance, callsToday, positiveSentimentPct, objectMetrics, topInterestedClients });
  } catch (err) { res.status(500).json({ error: safeErrorMessage(err) }); }
});

module.exports = router;
