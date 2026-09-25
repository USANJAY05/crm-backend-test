// src/ai/postCallAgents/workflowAnswersAgent.js
// ============================================================
// Post-call workflow Q&A extraction — re-reads the transcript against the
// workflow's assigned questions and pulls out each answer, labeled by the
// workflow variable's name (see DialerSimulator.tsx's "Extracted Campaign
// Answers" panel, which displays these).
// ============================================================

const { z } = require("zod");
const { getEffectivePrompt } = require("../systemAgents");
const { generateStructured } = require("./shared");

// Structured-output/function-calling schemas need an object at the root
// (a bare top-level array isn't valid there) — the array of answers is
// nested under `answers` and unwrapped again below.
const QAExtractionSchema = z.object({
  answers: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().default(""),
  })).default([]),
});

// Accepts either legacy plain-string questions or the newer
// { label, question, dataType } shape (label = short key like
// "customer_budget", question = full text asked aloud, dataType = the
// workflow variable's declared type — text/number/boolean/date/choice)
// and normalizes to that shape. A plain string's label defaults to its
// own text and gets no dataType, so legacy callers see identical output
// to before dataType existed.
function normalizeQuestions(questions) {
  const seen = new Set();
  const normalized = [];
  for (const q of (questions || [])) {
    const item = typeof q === "string"
      ? { label: q, question: q, dataType: undefined }
      : {
          label: q.label || q.question,
          question: q.question || q.label,
          dataType: q.dataType,
          options: Array.isArray(q.options) ? q.options : (Array.isArray(q.choices) ? q.choices : []),
          optional: q.optional === true || q.required === false,
        };
    const key = String(item.question || item.label || "").trim().replace(/\\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

// Per-type formatting instructions given to the model alongside each
// question, so the extracted answer actually matches what the workflow
// variable declared it should be instead of always being whatever loose
// phrase the caller happened to say.
const TYPE_INSTRUCTIONS = {
  number: "reply with digits only (e.g. \"30\", not \"thirty years\" or \"around 30\")",
  boolean: "reply with exactly \"Yes\" or \"No\"",
  date: "reply with a clear date (e.g. \"2026-09-20\" or \"20 Sep 2026\"), resolving relative phrases like \"next Monday\" if the transcript gives enough context",
  choice: "reply with exactly one of the options the caller chose, worded as they said it",
  text: "reply with the caller's answer as a short plain phrase",
};

// Deterministic, safe normalization applied AFTER the model replies —
// only for booleans, since "Yes"/"No" synonyms (yeah, nope, definitely,
// no way) are the one case that's both common and unambiguous to fix up
// without risking losing real information a number/date/text answer
// might carry (e.g. "1 Crore" or "30 years" stripped down to bare digits
// would throw away a real unit the rest of the app still needs to show).
const YES_WORDS = /^(y|yes|yeah|yep|yup|sure|correct|true|definitely|of course)\b/i;
const NO_WORDS = /^(n|no|nope|nah|not really|never|false)\b/i;
function coerceAnswer(answer, dataType) {
  if (dataType !== "boolean" || !answer) return answer;
  const trimmed = answer.trim();
  if (YES_WORDS.test(trimmed)) return "Yes";
  if (NO_WORDS.test(trimmed)) return "No";
  return answer;
}

async function extractWorkflowAnswers(transcript, questions, orgId = null, onUsage) {
  const normalized = normalizeQuestions(questions);
  if (!transcript?.trim() || !normalized.length) return [];
  const template = await getEffectivePrompt(orgId, "workflow-answer-extractor");
  const prompt = template
    .replace("{questions}", normalized.map((q, i) => {
      const typeNote = q.dataType && TYPE_INSTRUCTIONS[q.dataType]
        ? ` (Expected type: ${q.dataType} — ${TYPE_INSTRUCTIONS[q.dataType]})`
        : "";
      return `${i + 1}. ${q.question}${typeNote}`;
    }).join("\n"))
    .replace("{transcript}", transcript);
  const parsed = await generateStructured({
    label: "qa-extraction",
    orgId,
    prompt,
    schema: QAExtractionSchema,
    fallback: { answers: [] },
    onUsage,
  });
  const results = parsed.answers;

  // Re-attach each result's label by matching back to the original question
  // text (the LLM only ever echoes `question`/`answer`) — exact match first,
  // falling back to positional index if the LLM reworded a question. Then
  // apply the safe post-hoc coercion above using that same matched
  // question's declared type.
  return results.map((r, i) => {
    const match = normalized.find((q) => q.question === r.question) || normalized[i];
    return {
      label: match ? match.label : r.question,
      question: r.question,
      answer: coerceAnswer(r.answer, match?.dataType),
    };
  });
}



function isUsableWorkflowAnswer(answer) {
  if (answer == null) return false;
  const value = String(answer).trim();
  if (!value) return false;
  return !/^(?:unknown|n\/a|na|not provided|not answered|no answer|unanswered|null|undefined)$/i.test(value);
}

function isValidWorkflowAnswer(answer, question) {
  if (!isUsableWorkflowAnswer(answer)) return false;
  const value = String(answer).trim();
  const type = String(question?.dataType || "text").toLowerCase();

  if (type === "number") {
    return /^[-+]?\\d+(?:[.,]\\d+)?$/.test(value.replace(/,/g, ""));
  }
  if (type === "boolean") {
    return /^(?:yes|no)$/i.test(value);
  }
  if (type === "date") {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }
  if (type === "choice" && Array.isArray(question?.options) && question.options.length) {
    return question.options.some((option) =>
      String(option?.label ?? option?.value ?? option).trim().toLowerCase() === value.toLowerCase()
    );
  }
  return true;
}

/**
 * Strict workflow completion gate.
 *
 * Every workflow question is mandatory by default. A question is skippable
 * only when its definition explicitly has optional=true or required=false.
 * Answers must come from the extracted/saved caller answers; the validator
 * never infers missing values.
 */
function validateWorkflowAnswers(questions, answers) {
  const normalized = normalizeQuestions(questions);
  if (!normalized.length) {
    return { complete: true, missingQuestions: [], requiredQuestions: [] };
  }

  const rows = Array.isArray(answers) ? answers : [];
  const byQuestion = new Map();
  const byLabel = new Map();

  for (const row of rows) {
    if (!row) continue;
    const answer = row.answer;
    if (row.question) byQuestion.set(String(row.question).trim().toLowerCase(), answer);
    if (row.label) byLabel.set(String(row.label).trim().toLowerCase(), answer);
  }

  const missingQuestions = normalized
    .filter((q) => !q.optional)
    .filter((q) => {
      const answer = byQuestion.get(String(q.question || "").trim().toLowerCase())
        ?? byLabel.get(String(q.label || "").trim().toLowerCase());
      return !isValidWorkflowAnswer(answer, q);
    })
    .map((q) => ({
      label: q.label,
      question: q.question,
      dataType: q.dataType || null,
    }));

  return {
    complete: missingQuestions.length === 0,
    missingQuestions,
    requiredQuestions: normalized.filter((q) => !q.optional).map((q) => ({
      label: q.label,
      question: q.question,
      dataType: q.dataType || null,
    })),
  };
}

module.exports = { normalizeQuestions, extractWorkflowAnswers, validateWorkflowAnswers, isUsableWorkflowAnswer, isValidWorkflowAnswer };
