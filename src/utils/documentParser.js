// ============================================================
// services/documentParser.js
//
// Extracts plain text from uploaded knowledge-base files so they can be
// chunked/embedded the same way pasted text already is (see
// knowledgeBase.js). One extractor per format — add more here as new
// formats are needed, rather than teaching the route handler about file
// formats directly.
// ============================================================

const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function extractSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((sheetName) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    return `Sheet: ${sheetName}\n${csv}`;
  }).join("\n\n");
}

function extractPlainText(buffer) {
  return buffer.toString("utf8");
}

const EXTRACTORS = {
  ".pdf": extractPdf,
  ".docx": extractDocx,
  ".xlsx": extractSpreadsheet,
  ".xls": extractSpreadsheet,
  ".csv": extractPlainText,
  ".txt": extractPlainText,
  ".md": extractPlainText
};

const SUPPORTED_EXTENSIONS = Object.keys(EXTRACTORS);

function extensionOf(filename) {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

// Returns extracted plain text, or throws a 400 error naming the
// unsupported extension (including .doc — the old binary Word format,
// which mammoth deliberately doesn't support, only .docx).
async function extractText(filename, buffer) {
  const ext = extensionOf(filename);
  const extractor = EXTRACTORS[ext];
  if (!extractor) {
    const err = new Error(`Unsupported file type "${ext || filename}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
    err.statusCode = 400;
    throw err;
  }
  const text = await extractor(buffer);
  if (!text || !text.trim()) {
    const err = new Error("No extractable text found in this file.");
    err.statusCode = 400;
    throw err;
  }
  return text;
}

module.exports = { extractText, SUPPORTED_EXTENSIONS };
