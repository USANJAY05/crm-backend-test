// ============================================================
// services/vectorStore.js
//
// Real semantic search backing for the knowledge base (services/
// knowledgeBase.js), via a self-hosted Chroma server (CHROMA_URL, default
// http://localhost:8000 — run one with e.g.
// `docker run -p 8000:8000 chromadb/chroma`) and Gemini's embedding model
// for turning text into vectors. Replaces the previous substring
// `LIKE %query%` match in the old local shim, which wasn't doing any
// real search at all.
//
// One Chroma collection per org (`kb_<orgId>`), so orgs never share
// vector space. If Chroma isn't reachable, every call here throws — the
// caller (knowledgeBase.js) is responsible for surfacing that clearly
// rather than silently falling back to fake results.
// ============================================================

const { ChromaClient } = require("chromadb");
const genai = require("./googleAiClient");

const EMBEDDING_MODEL = "text-embedding-004";

class GeminiEmbeddingFunction {
  async generate(texts) {
    const res = await genai.models.embedContent({ model: EMBEDDING_MODEL, contents: texts });
    return (res.embeddings || []).map((e) => e.values);
  }
}

const embeddingFunction = new GeminiEmbeddingFunction();

let client = null;
function getClient() {
  if (!client) {
    client = new ChromaClient({ path: process.env.CHROMA_URL || "http://localhost:8000" });
  }
  return client;
}

// Chroma collection names must be 3-63 chars, alphanumeric/underscore/
// hyphen, starting and ending alphanumeric — `kb_<uuid>` always satisfies
// that since org ids are uuids.
function collectionName(orgId) {
  return `kb_${orgId}`;
}

async function getCollection(orgId) {
  return getClient().getOrCreateCollection({ name: collectionName(orgId), embeddingFunction });
}

// Adds chunk texts for a document. `chunks` is [{ id, content }]; each id
// should be the corresponding knowledge_chunks row id so deletes can match
// by document.
async function addChunks(orgId, documentId, documentTitle, chunks) {
  if (!chunks.length) return;
  const collection = await getCollection(orgId);
  await collection.add({
    ids: chunks.map((c) => c.id),
    documents: chunks.map((c) => c.content),
    metadatas: chunks.map(() => ({ document_id: documentId, document_title: documentTitle }))
  });
}

async function deleteDocument(orgId, documentId) {
  const collection = await getCollection(orgId);
  await collection.delete({ where: { document_id: documentId } });
}

async function search(orgId, query, limit) {
  const collection = await getCollection(orgId);
  const result = await collection.query({ queryTexts: [query], nResults: limit });
  const documents = result.documents?.[0] || [];
  const metadatas = result.metadatas?.[0] || [];
  return documents.map((content, i) => ({
    content,
    documentTitle: metadatas[i]?.document_title || "Untitled"
  }));
}

module.exports = { addChunks, deleteDocument, search };
