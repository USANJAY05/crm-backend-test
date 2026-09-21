// src/lib/callerTimezone.js
// ============================================================
// Best-effort IANA timezone for a caller's phone number, derived from its
// country code (libphonenumber-js) — used by the follow-up/callback agent
// to resolve "after 30 minutes" / "tomorrow at 5pm" against the CALLER's
// actual local time instead of the server's UTC clock. Multi-timezone
// countries (US, Canada, Russia, Australia, Brazil, ...) only get one
// approximate zone each — area-code-level precision would need a much
// heavier phone->timezone dataset than this needs to justify; the common
// case (a single-timezone country, which covers the large majority of
// real call traffic for this app) is exact.
// ============================================================

const { parsePhoneNumberFromString } = require("libphonenumber-js");

// One representative IANA zone per ISO 3166-1 alpha-2 country code.
const COUNTRY_TIMEZONE = {
  IN: "Asia/Kolkata",
  US: "America/New_York",
  CA: "America/Toronto",
  GB: "Europe/London",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  PH: "Asia/Manila",
  ID: "Asia/Jakarta",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  PK: "Asia/Karachi",
  BD: "Asia/Dhaka",
  LK: "Asia/Colombo",
  NP: "Asia/Kathmandu",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  IE: "Europe/Dublin",
  ZA: "Africa/Johannesburg",
  NG: "Africa/Lagos",
  EG: "Africa/Cairo",
  KE: "Africa/Nairobi",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  AR: "America/Argentina/Buenos_Aires",
  RU: "Europe/Moscow",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
  OM: "Asia/Muscat",
  BH: "Asia/Bahrain",
};

// This org's default operating market (per its own context — a lending/
// insurance CRM built around Indian outbound calling) — used when a
// number can't be parsed at all (missing country code, malformed).
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function getCallerTimezone(phoneNumber) {
  try {
    const parsed = parsePhoneNumberFromString(String(phoneNumber || ""));
    if (parsed && parsed.country && COUNTRY_TIMEZONE[parsed.country]) {
      return COUNTRY_TIMEZONE[parsed.country];
    }
  } catch (_) { /* fall through to default */ }
  return DEFAULT_TIMEZONE;
}

module.exports = { getCallerTimezone, COUNTRY_TIMEZONE, DEFAULT_TIMEZONE };
