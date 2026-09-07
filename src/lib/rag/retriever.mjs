// Hybrid retrieval over rag_chunks (RAG_SPEC §4.2/§4.3) — the PROPOSER layer.
//
// Consumption contract (anti-hallucination guarantee, unchanged): hits are
// retrieval proposals. They are never citations; consumers resolve
// {lawId, articleNo} through /api/kb/resolve (resolveRef) before any
// citation display. Every hit carries the linked provision's verified flag
// and provisional-source provenance so the UI can badge it.
//
// Lexical: BM25 (k1=1.5 b=0.75) over the same arabic tokenization as
// /api/search — one shared implementation (arabic.mjs). The BM25 index over
// chunks is cached per-process and invalidated explicitly after ingest
// (bustRetrievalCache); at ~10³ chunks a cached in-memory index serves
// single-digit-ms queries (measured 80–130ms to BUILD at 868 docs —
// Task 11 measurement). Persisted Postgres FTS + pgvector is the Phase R0
// upgrade behind the same interface (C-R5), documented in
// docs/rag/IMPLEMENTATION_STATUS.md.
// Dense: cosine over locally-served bge-m3 embeddings when available,
// fused by RRF (k=60). Otherwise lexical-only — meta.embedMode says which.

import { buildIndex, bm25Score, tokenize, normalizeAr } from '../arabic.mjs';
import { loadCandidates, loadAllVersions, logQuery } from './store.mjs';
import { embedOne, cosine, rrfFuse, embedConfigured } from './embed.mjs';
import { createHash } from 'node:crypto';

/**
 * @typedef {Object} RagSearchArgs
 * @property {string} q
 * @property {string} [lawId]
 * @property {string} [asOf]        ISO date; default today (UTC)
 * @property {'current'|'historical'|'all'} [versions]
 * @property {number} [limit]
 * @property {string|null} [orgId]  query-log attribution only (query text never stored)
 */

const g = /** @type {any} */ (globalThis);

export function bustRetrievalCache() { g.__bbRagCache = undefined; }

const cacheKey = (rows) => `${rows.length}:${rows[0]?.created_at ?? ''}:${rows[rows.length - 1]?.created_at ?? ''}`;

function getOrCreateIndex(rows) {
  const key = cacheKey(rows);
  if (g.__bbRagCache?.key === key) return g.__bbRagCache;
  const idx = buildIndex(rows, (d) => d.text_normalized || '');
  const byId = new Map(rows.map(r => [r.id, r]));
  const tokensById = new Map(idx.docs.map(d => [d.id, d.tokens]));
  g.__bbRagCache = { key, idx, byId, tokensById };
  return g.__bbRagCache;
}

const parseEmb = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; } };

const snippet = (text, qTokens = []) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 260) return t;
  if (qTokens.length) {
    const norm = normalizeAr(t);
    for (const tok of qTokens) {
      const at = norm.indexOf(tok);
      if (at > 0) return '…' + t.slice(Math.max(0, at - 80), at + 180) + '…';
    }
  }
  return t.slice(0, 260) + '…';
};

/** @param {RagSearchArgs} args */
export async function ragSearch(ctx, args) {
  const t0 = Date.now();
  const q = String(args.q || '').trim();
  const versions = args.versions === 'historical' || args.versions === 'all' ? args.versions : 'current';
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
  const asOf = args.asOf || new Date().toISOString().slice(0, 10);

  const emptyMeta = { embedMode: 'lexical', backend: ctx.dialect, total: 0, asOf, versions };
  if (!q) return { query: q, asOf, versions, meta: emptyMeta, results: [] };

  // ---- candidate pool (temporal filter applied in SQL, before scoring) ----
  const rows = await loadCandidates(ctx, { lawId: args.lawId, asOf });
  let pool = rows;

  // versions=historical/all: union in the closed-window versions of articles
  // that matched the current pool (the superseded chain, each hit carrying
  // its explicit validity window — spec §4.2).
  if (versions !== 'current' && pool.length) {
    const extra = [];
    const seenIds = new Set(pool.map((r) => r.id));
    for (const r of pool.slice(0, 40)) {
      const chain = await loadAllVersions(ctx, { lawId: r.law_id, articleNo: r.article_no });
      for (const c of chain) if (!seenIds.has(c.id)) { seenIds.add(c.id); extra.push(c); }
    }
    pool = pool.concat(extra);
  }

  if (!pool.length) {
    const meta = { ...emptyMeta };
    await logQuery(ctx, { orgId: args.orgId, queryHash: createHash('sha256').update(normalizeAr(q)).digest('hex'), latencyMs: Date.now() - t0, embedMode: meta.embedMode });
    return { query: q, asOf, versions, meta, results: [] };
  }

  // ---- lexical ranking ----
  const { idx, byId, tokensById } = getOrCreateIndex(pool);
  const qTokens = tokenize(q);
  const lexical = pool
    .map((r) => ({ r, score: qTokens.length ? bm25Score(qTokens, tokensById.get(r.id) || [], idx.df, idx.N, idx.avgdl) : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // ---- dense ranking (optional, local-only) ----
  let dense = [];
  let embedMode = 'lexical';
  const qEmb = embedConfigured() ? await embedOne(q) : null;
  const anyEmbedded = pool.some((r) => r.embedding);
  if (qEmb && anyEmbedded) {
    dense = pool
      .map((r) => ({ r, score: cosine(qEmb, parseEmb(r.embedding)) }))
      .filter((x) => x.score > 0.01)
      .sort((a, b) => b.score - a.score);
    embedMode = lexical.length && dense.length ? 'hybrid' : 'dense';
  }

  // ---- fusion ----
  let ordered;
  if (dense.length) {
    const fused = rrfFuse(lexical.slice(0, 60).map((x) => x.r.id), dense.slice(0, 60).map((x) => x.r.id));
    ordered = fused.map((f) => ({ r: byId.get(f.id), score: f.score }));
  } else {
    ordered = lexical.map((x) => ({ r: x.r, score: x.score }));
  }

  // ---- enrich through the LKB (read-only) ----
  const results = [];
  for (const { r, score } of ordered.slice(0, limit)) {
    let provision = null;
    if (r.provision_id) {
      const rowsP = await ctx.all(
        'SELECT id, version, verified, is_active, gazette_ref, effective_from, effective_to, amendment_version FROM legal_provisions WHERE id = ?',
        [r.provision_id]
      );
      provision = rowsP[0] ?? null;
    }
    results.push({
      chunkId: r.id,
      provisionId: provision?.id ?? null,
      lawId: r.law_id,
      articleNo: r.article_no,
      articlePart: r.article_part,
      version: provision?.version ?? null,
      amendmentVersion: provision?.amendment_version ?? r.amendment_version,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      gazetteRef: { issue: r.gazette_issue, date: r.gazette_date, page: null },
      chapterHeading: r.chapter_heading,
      snippet: snippet(r.text_canonical, qTokens),
      score: Math.round(score * 1000) / 1000,
      // verification state follows the LINKED provision (the LKB stays the
      // sole authority); unlinked or unverified ⇒ the unverified badge.
      verified: provision ? !!provision.verified && !!provision.is_active : false,
      chunkStatus: r.status,
      provisionalSource: !r.gazette_issue || String(r.gazette_issue).startsWith('MIRROR-')
    });
  }

  const meta = { embedMode, backend: ctx.dialect, total: lexical.length + (dense.length ? dense.length : 0), asOf, versions };
  await logQuery(ctx, { orgId: args.orgId, queryHash: createHash('sha256').update(normalizeAr(q)).digest('hex'), latencyMs: Date.now() - t0, embedMode });
  return { query: q, asOf, versions, meta, results };
}
