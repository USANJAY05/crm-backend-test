// ============================================================
// services/knowledgeBase.js
//
// Per-org knowledge base. Document metadata (title, chunk count) lives in
// the MySQL `knowledge_documents`/`knowledge_chunks` tables; real
// semantic search runs against Chroma via services/vectorStore.js
// (embeddings from Gemini). Documents are chunked into paragraphs at
// upload time, same as before — only the search backend changed, from a
// substring `LIKE %query%` match to real vector similarity search.
// ============================================================

const db = require("../db/repository");
const vectorStore = require("./vectorStore");

function requireSupabase() {
  if (!db.supabase) {
    const err = new Error("Knowledge base requires the MySQL database to be configured.");
    err.statusCode = 503;
    throw err;
  }
}

const MAX_CHUNK_CHARS = 1000;

// Splits on blank lines (paragraphs); any paragraph still too long gets
// hard-split at sentence boundaries. Simple on purpose — this is meant to
// keep search results reasonably self-contained, not to be a "smart" RAG
// chunker.
function chunkText(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK_CHARS) {
      chunks.push(para);
      continue;
    }
    const sentences = para.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if ((current + " " + sentence).length > MAX_CHUNK_CHARS && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}

async function addDocument(orgId, title, text) {
  requireSupabase();
  if (!title || !text || !text.trim()) {
    const err = new Error("title and text are required");
    err.statusCode = 400;
    throw err;
  }

  const { data: doc, error: docErr } = await db.supabase
    .from("knowledge_documents")
    .insert({ org_id: orgId, title })
    .select()
    .single();
  if (docErr) throw new Error(`[knowledgeBase.addDocument] ${docErr.message}`);

  const chunks = chunkText(text);
  if (chunks.length) {
    const { data: chunkRows, error: chunkErr } = await db.supabase.from("knowledge_chunks").insert(
      chunks.map((content, i) => ({ org_id: orgId, document_id: doc.id, content, chunk_index: i }))
    ).select();
    if (chunkErr) throw new Error(`[knowledgeBase.addDocument] chunks: ${chunkErr.message}`);
    await vectorStore.addChunks(orgId, doc.id, doc.title, (chunkRows || []).map((r) => ({ id: r.id, content: r.content })));
  }

  return { id: doc.id, title: doc.title, chunkCount: chunks.length, createdAt: doc.created_at };
}

async function listDocuments(orgId) {
  requireSupabase();
  const { data, error } = await db.supabase
    .from("knowledge_documents")
    .select("id, title, created_at, knowledge_chunks(count)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`[knowledgeBase.listDocuments] ${error.message}`);
  return (data || []).map((d) => ({
    id: d.id,
    title: d.title,
    createdAt: d.created_at,
    chunkCount: d.knowledge_chunks?.[0]?.count ?? 0
  }));
}

async function deleteDocument(orgId, documentId) {
  requireSupabase();
  const { error } = await db.supabase.from("knowledge_documents").delete().eq("id", documentId).eq("org_id", orgId);
  if (error) throw new Error(`[knowledgeBase.deleteDocument] ${error.message}`);
  await vectorStore.deleteDocument(orgId, documentId);
  return true;
}

// documentIds, when given, restricts the search to only those documents —
// used when an agent is scoped to specific knowledge base documents rather
// than the org's whole knowledge base.
async function search(orgId, query, limit = 3, documentIds = null) {
  if (!query || !query.trim()) return [];
  return vectorStore.search(orgId, query, limit, documentIds);
}

// Whether this org has any knowledge base content at all — used to decide
// whether to register the search tool / do a RAG lookup at all. Pass
// documentIds to check only those specific documents exist instead of any
// document in the org (e.g. an agent scoped to documents that were since
// deleted should not act like it still has a knowledge base).
async function hasContent(orgId, documentIds = null) {
  if (!db.supabase) return false;
  let q = db.supabase
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (documentIds?.length) q = q.in("id", documentIds);
  const { count, error } = await q;
  if (error) return false;
  return (count || 0) > 0;
}

// Small knowledge bases (a few KB of text) are cheaper to hand to the model
// whole, in the system prompt, than to make it stop mid-call and call a
// tool to fetch them — search_knowledge_base was measured adding 2.5-4s of
// real dead air per lookup (round trip + the model composing an answer
// from the retrieved snippet). Loading everything up front means the
// model already has the facts and can answer instantly, no tool call.
const MAX_INLINE_CHARS = 30000;

// documentIds, when given, inlines only those documents instead of the
// org's entire knowledge base — used when an agent is scoped to specific
// documents rather than "all".
async function getAllContent(orgId, documentIds = null) {
  if (!db.supabase) return null;
  let q = db.supabase
    .from("knowledge_chunks")
    .select("content")
    .eq("org_id", orgId)
    .order("chunk_index", { ascending: true });
  if (documentIds?.length) q = q.in("document_id", documentIds);
  const { data, error } = await q;
  if (error || !data || !data.length) return null;
  const full = data.map((r) => r.content).join("\n\n");
  if (full.length > MAX_INLINE_CHARS) return null; // too big to inline safely — caller falls back to the search tool
  return full;
}

module.exports = { addDocument, listDocuments, deleteDocument, search, hasContent, getAllContent };
