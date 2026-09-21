"use strict";

// Converts internal errors into safe API messages. 5xx responses never expose
// SQL, provider response bodies, credentials, filesystem paths, or stack data.
function safeErrorMessage(error, fallback = "Internal server error") {
  const status = Number(error?.statusCode || error?.status || 500);
  if (status >= 400 && status < 500 && error?.expose === true && error?.message) {
    return String(error.message);
  }
  return fallback;
}

function safeErrorResponse(error, fallback = "Internal server error") {
  return { error: safeErrorMessage(error, fallback) };
}

module.exports = { safeErrorMessage, safeErrorResponse };
