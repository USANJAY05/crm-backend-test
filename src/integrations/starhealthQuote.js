const { getLogger } = require("../observability/logger");
const log = getLogger("integrations.starhealthQuote");
// ============================================================
// services/starhealthQuote.js
//
// Wraps starhealth-quote-cli's runQuote() (Playwright automation of Star
// Health's live AtomPro "Get Quote" flow) for use as a Gemini voice-agent
// tool. runQuote attaches over CDP to an already-open Chrome window
// (Akamai bot protection blocks freshly-launched automated browsers) —
// that Chrome runs persistently on THIS SAME VM as systemd services
// (starhealth-xvfb + starhealth-chrome), bound to 127.0.0.1:9222 only.
// Since backend and Chrome are on the same host, no network tunnel is
// needed — just a plain loopback connection.
//
// starhealth-quote-cli is an ESM package; this file is CommonJS, so it's
// loaded via dynamic import() (cached after the first call).
// ============================================================

const CDP_ENDPOINT = process.env.STARHEALTH_CDP_ENDPOINT || "http://127.0.0.1:9222";

let runQuotePromise = null;
function loadRunQuote() {
  if (!runQuotePromise) {
    runQuotePromise = import("starhealth-quote-cli").then((mod) => mod.runQuote);
  }
  return runQuotePromise;
}

// AtomPro's live age dropdowns read like "35 yrs" (adults/parents) — a
// voice caller just says "35" or "35 years old". Bare digits get the
// common "N yrs" suffix; anything that already looks like it has a unit
// is left as-is for applySelectOption's exact-text match.
function normalizeAge(age) {
  const raw = String(age || "").trim();
  if (/^\d+$/.test(raw)) return `${raw} yrs`;
  return raw.replace(/\byears?\b/i, "yrs").replace(/\s+/g, " ").trim();
}

// Voice calls collect free-form speech, not exact catalog strings — this
// maps what the AI tool call gives us onto the field shapes runQuote
// expects. Values that don't match the site's live options surface as a
// normal runQuote error (unmatched dropdown option), handled by the
// timeout/error path below rather than crashing the call.
function buildRunQuoteInput(args) {
  const members = (Array.isArray(args.members) ? args.members : []).map((m) => ({
    ...m,
    age: normalizeAge(m.age),
  }));
  const countByType = (type) => members.filter((m) => m.type === type).length;
  return {
    pincode: String(args.pincode || "").replace(/\D/g, "").slice(0, 6),
    category: args.category || "Health",
    product: args.product || "Recommend Me",
    policyPlan: args.policyPlan || "Fresh",
    policyType: args.policyType || "Floater",
    numParents: args.numParents ?? countByType("Parent"),
    numAdults: args.numAdults ?? countByType("Adult"),
    numChildren: args.numChildren ?? countByType("Child"),
    members,
    sumInsured: args.sumInsured || "10 Lakh",
    policyPeriod: args.policyPeriod || "1 Year",
    ped: args.ped || "No",
  };
}

// Races the (potentially slow, multi-step Playwright) quote fetch against
// a timeout so a live call never sits in dead air waiting on it — callers
// should fall back to an async/deferred quote on 'timeout' or 'error'
// rather than retry inline.
async function getQuoteWithTimeout(args, timeoutMs = 25000) {
  try {
    const runQuote = await loadRunQuote();
    const input = buildRunQuoteInput(args);
    if (!/^\d{6}$/.test(input.pincode)) {
      return { status: "error", message: "Invalid or missing 6-digit pincode." };
    }

    const quotePromise = runQuote(input, CDP_ENDPOINT);
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve({ __timedOut: true }), timeoutMs)
    );

    const result = await Promise.race([quotePromise, timeoutPromise]);
    if (result && result.__timedOut) {
      return { status: "timeout", input };
    }
    return { status: "ok", plans: result, input };
  } catch (err) {
    log.error("❌ Star Health quote fetch failed:", err.message);
    return { status: "error", message: err.message };
  }
}

module.exports = { getQuoteWithTimeout };
