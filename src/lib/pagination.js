// src/lib/pagination.js — shared query-param parsing for server-side
// pagination. A route opts in by calling this and checking the result;
// routes that don't call it (or callers that omit ?page/?limit) keep
// getting the full, unpaginated list — this never changes default
// behavior on its own.

const MAX_LIMIT = 500;

// Returns { page, limit } when the request explicitly asked for a page
// (both params present and valid), otherwise null.
function parsePagination(query) {
  const page = parseInt(query.page, 10);
  const limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || limit < 1) return null;
  return { page, limit: Math.min(limit, MAX_LIMIT) };
}

module.exports = { parsePagination };
