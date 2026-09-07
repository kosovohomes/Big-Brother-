// RAG persistence — additive tables (docs/RAG_SPEC.md §4.1) shared by the
// Next.js server (ctx built from the Phase A storage driver) and the ingest
// CLI (ctx built from the reaper-style backend plumbing in scripts/*).
//
// Tables (purely additive — no existing table touched):
//   rag_ingest_jobs       one per manifest (idempotency key = manifest_hash)
//   rag_chunks            article-anchored chunks (retrieval proposals ONLY —
//                         LegalProvision stays the sole citation source)
//   provision_amendments  amendment-formula detections (lawyer-gated apply)
//   rag_query_log         org-scoped query telemetry — query TEXT IS NEVER
//                         STORED, only sha256 of the normalized query
//
// A "ctx" is { dialect, all(sql, params), run(sql, params), exec(sql) }.
// The server builds it from getDriver(); CLIs build it from their own
// backend plumbing. All SQL uses `?` placeholders (the pg driver and the
// CLI pg plumbing both rewrite ? -> $n quote-aware).

import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const cuidish = () => 'c' + randomBytes(12).toString('hex');
export const nowIso = () => new Date().toISOString();
export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');
export const uuid = () => randomUUID();

// Decree-Law 80/2026 — hard ingestion blocklist (README.md:17, PRD v2.1
// Change 4). NEVER remove or weaken; e2e RAG-15 asserts the block.
export const BLOCKED_LAWS = new Set(['80/2026']);

// Chunk statuses served by retrieval: proposals before lawyer sign-off are
// retrievable but always badged unverified (spec §4.3); REJECTED never is.
export const RETRIEVABLE_STATUSES = ['CHUNKED', 'EMBEDDED', 'LIVE'];

export async function ensureRagSchema(ctx) {
  const smallint = ctx.dialect === 'pg' ? 'SMALLINT' : 'INTEGER';
  const ddl = `
CREATE TABLE IF NOT EXISTS rag_ingest_jobs (
  id TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL UNIQUE,
  issue_no TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'txt',
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  attested ${smallint} NOT NULL DEFAULT 0,
  ocr_engine TEXT,
  stats TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  provision_id TEXT,
  law_id TEXT NOT NULL,
  article_no TEXT NOT NULL,
  article_part INTEGER NOT NULL DEFAULT 1,
  chapter_heading TEXT,
  amendment_version TEXT NOT NULL DEFAULT 'original',
  effective_from TEXT,
  effective_to TEXT,
  gazette_issue TEXT,
  gazette_date TEXT,
  text_canonical TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  embedding TEXT,
  ocr_engine TEXT,
  ocr_confidence REAL,
  ingest_job_id TEXT NOT NULL,
  is_active ${smallint} NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'CHUNKED',
  created_at TEXT NOT NULL,
  UNIQUE(law_id, article_no, article_part, text_hash)
);
CREATE INDEX IF NOT EXISTS rag_chunks_law_article ON rag_chunks(law_id, article_no);
CREATE INDEX IF NOT EXISTS rag_chunks_job ON rag_chunks(ingest_job_id);

CREATE TABLE IF NOT EXISTS provision_amendments (
  id TEXT PRIMARY KEY,
  amending_law_id TEXT,
  amending_article TEXT,
  target_law_id TEXT NOT NULL,
  target_article TEXT NOT NULL,
  action TEXT NOT NULL,
  gazette_issue TEXT,
  gazette_date TEXT,
  new_provision_id TEXT,
  applied_at TEXT,
  detected_by TEXT NOT NULL DEFAULT 'pipeline',
  approved_by TEXT,
  ingest_job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prov_amend_target ON provision_amendments(target_law_id, target_article);

CREATE TABLE IF NOT EXISTS rag_query_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  query_hash TEXT NOT NULL,
  latency_ms INTEGER,
  embed_mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rag_query_log_org ON rag_query_log(org_id);
`;

  // On Postgres the DDL is normally provisioned by scripts/pg/007_rag.sql
  // (run by the migrator role). The runtime/CLI only creates what is
  // missing — a non-migrator connection (bb_system) must not attempt
  // CREATE when everything already exists (permission denied on schema).
  if (ctx.dialect === 'pg') {
    const rows = await ctx.all(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN
         ('rag_ingest_jobs','rag_chunks','provision_amendments','rag_query_log')`
    );
    if (Number(rows[0]?.n ?? 0) >= 4) return;
  }
  ctx.exec(ddl);
}

// ---------- jobs ----------

export async function getJobByManifestHash(ctx, manifestHash) {
  return (await ctx.all('SELECT * FROM rag_ingest_jobs WHERE manifest_hash = ?', [manifestHash]))[0] ?? null;
}

export async function insertJob(ctx, job) {
  await ctx.run(
    `INSERT INTO rag_ingest_jobs
       (id, manifest_hash, issue_no, publish_date, source_type, source_path, source_sha256,
        status, attested, ocr_engine, stats, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [job.id, job.manifestHash, job.issueNo, job.publishDate, job.sourceType ?? 'txt', job.sourcePath,
      job.sourceSha256, job.status, job.attested ? 1 : 0, job.ocrEngine ?? null, job.stats ?? null,
      job.createdBy ?? null, job.createdAt ?? nowIso(), job.updatedAt ?? null]
  );
  return job.id;
}

export async function updateJob(ctx, id, status, stats) {
  await ctx.run('UPDATE rag_ingest_jobs SET status = ?, stats = ?, updated_at = ? WHERE id = ?',
    [status, typeof stats === 'string' ? stats : JSON.stringify(stats ?? null), nowIso(), id]);
}

// ---------- chunks ----------

// Append-only supersede: when a newer chunk for the same (law, article, part)
// is ingested with different text, the older chunk's validity window is CLOSED
// (effective_to = new publish date). Text rows are never mutated or deleted —
// historical retrieval (versions=all/historical) keeps serving them with their
// explicit window (RAG_SPEC §2.4 / §4.2, e2e RAG-04..08).
export async function closeSupersededChunks(ctx, { lawId, articleNo, articlePart, publishDate, excludeTextHash }) {
  return (await ctx.run(
    `UPDATE rag_chunks SET effective_to = ?
     WHERE law_id = ? AND article_no = ? AND article_part = ?
       AND text_hash <> ? AND (effective_to IS NULL OR effective_to > ?)`,
    [publishDate, lawId, articleNo, articlePart, excludeTextHash, publishDate]
  )).changes ?? 0;
}

export async function insertChunk(ctx, c) {
  let r;
  try {
    r = await ctx.run(
      `INSERT INTO rag_chunks
         (id, provision_id, law_id, article_no, article_part, chapter_heading, amendment_version,
          effective_from, effective_to, gazette_issue, gazette_date,
          text_canonical, text_normalized, text_hash, embedding, ocr_engine, ocr_confidence,
          ingest_job_id, is_active, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.id, c.provisionId ?? null, c.lawId, c.articleNo, c.articlePart ?? 1, c.chapterHeading ?? null,
        c.amendmentVersion ?? 'original', c.effectiveFrom ?? null, c.effectiveTo ?? null,
        c.gazetteIssue ?? null, c.gazetteDate ?? null,
        c.textCanonical, c.textNormalized, c.textHash,
        c.embedding ? JSON.stringify(c.embedding) : null,
        c.ocrEngine ?? null, c.ocrConfidence ?? null,
        c.ingestJobId, c.isActive === false ? 0 : 1, c.status ?? 'CHUNKED', c.createdAt ?? nowIso()]
    );
  } catch (e) {
    // Idempotency: unique (law_id, article_no, article_part, text_hash) — a
    // re-ingest of identical content is a no-op, not an error (RAG-16).
    // (try/catch, not .catch() — ctx.run may be synchronous on SQLite.)
    if (/UNIQUE|duplicate key/i.test(String(e?.message))) return 0;
    throw e;
  }
  return r.changes ?? 0; // 0 = idempotent skip
}

export async function insertAmendmentRecord(ctx, a) {
  await ctx.run(
    `INSERT INTO provision_amendments
       (id, amending_law_id, amending_article, target_law_id, target_article, action,
        gazette_issue, gazette_date, detected_by, ingest_job_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [a.id ?? cuidish(), a.amendingLawId ?? null, a.amendingArticle ?? null, a.targetLawId,
      a.targetArticle, a.action, a.gazetteIssue ?? null, a.gazetteDate ?? null,
      a.detectedBy ?? 'pipeline', a.ingestJobId ?? null, nowIso()]
  );
}

// LINKED step: attach an existing active LegalProvision when one active
// version matches (law, article). Never mutates the provision — linkage is a
// pointer only, and the provision's own verified flag drives the badge.
export async function linkChunkToProvision(ctx, { lawId, articleNo }) {
  const rows = await ctx.all(
    `SELECT id, version, verified, is_active FROM legal_provisions
     WHERE law_id = ? AND article_no = ? AND is_active = 1
     ORDER BY version DESC LIMIT 1`,
    [lawId, articleNo]
  );
  return rows[0] ?? null;
}

export async function setChunkProvision(ctx, chunkId, provisionId) {
  await ctx.run('UPDATE rag_chunks SET provision_id = ? WHERE id = ?', [provisionId, chunkId]);
}

// Content identity for the version chain: does this exact text already exist
// for (law, article, part)? Used to keep re-ingested older issues from
// regressing newer windows (a same-hash chunk is never window-closed).
export async function getChunkByHash(ctx, { lawId, articleNo, articlePart, textHash }) {
  return (await ctx.all(
    'SELECT id, provision_id, effective_from, effective_to FROM rag_chunks WHERE law_id = ? AND article_no = ? AND article_part = ? AND text_hash = ?',
    [lawId, articleNo, articlePart, textHash]
  ))[0] ?? null;
}

// Candidate fetch for retrieval — temporal filter applied BEFORE scoring
// (never as a post-filter). NULL effective_from means "current text pending
// Phase 0 dating" and stays retrievable (C-R10); a past effective_to closes
// the window and excludes the chunk from versions=current.
export async function loadCandidates(ctx, { lawId, asOf }) {
  const params = [asOf, asOf];
  let sql = `SELECT id, provision_id, law_id, article_no, article_part, chapter_heading,
       amendment_version, effective_from, effective_to, gazette_issue, gazette_date,
       text_canonical, text_normalized, text_hash, embedding, is_active, status, created_at
     FROM rag_chunks
     WHERE status IN ('CHUNKED','EMBEDDED','LIVE') AND is_active = 1
       AND (effective_from IS NULL OR effective_from <= ?)
       AND (effective_to IS NULL OR effective_to > ?)`;
  if (lawId) { sql += ' AND law_id = ?'; params.push(lawId); }
  sql += ' ORDER BY law_id, article_no, article_part';
  return ctx.all(sql, params);
}

// Window-open fetch — used to return the superseded chain
// (versions=historical/all) with explicit validity windows.
export async function loadAllVersions(ctx, { lawId, articleNo }) {
  return ctx.all(
    `SELECT id, provision_id, law_id, article_no, article_part, chapter_heading,
       amendment_version, effective_from, effective_to, gazette_issue, gazette_date,
       text_canonical, text_normalized, text_hash, embedding, is_active, status, created_at
     FROM rag_chunks
     WHERE status IN ('CHUNKED','EMBEDDED','LIVE') AND is_active = 1
       AND law_id = ? AND article_no = ?
     ORDER BY article_part, effective_from`,
    [lawId, articleNo]
  );
}

export async function logQuery(ctx, { orgId, queryHash, latencyMs, embedMode }) {
  await ctx.run('INSERT INTO rag_query_log (id, org_id, query_hash, latency_ms, embed_mode, created_at) VALUES (?,?,?,?,?,?)',
    [cuidish(), orgId ?? null, queryHash, latencyMs ?? null, embedMode ?? null, nowIso()]);
}

// ---------- status / coverage ----------

export async function getCoverage(ctx) {
  const rows = await ctx.all(
    `SELECT law_id,
            COUNT(*) AS chunks,
            SUM(CASE WHEN status IN ('EMBEDDED','LIVE') THEN 1 ELSE 0 END) AS embedded,
            SUM(CASE WHEN provision_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
            SUM(CASE WHEN effective_to IS NOT NULL THEN 1 ELSE 0 END) AS superseded,
            MIN(created_at) AS first_ingest
     FROM rag_chunks
     WHERE status <> 'REJECTED'
     GROUP BY law_id ORDER BY law_id`
  );
  return rows.map(r => ({
    lawId: r.law_id, chunks: Number(r.chunks), embedded: Number(r.embedded ?? 0),
    linked: Number(r.linked ?? 0), superseded: Number(r.superseded ?? 0), firstIngest: r.first_ingest
  }));
}

export async function getJobs(ctx, limit = 25) {
  return ctx.all(
    `SELECT id, manifest_hash, issue_no, publish_date, source_type, source_path, status, attested, stats, created_at
     FROM rag_ingest_jobs ORDER BY created_at DESC LIMIT ?`, [limit]
  );
}

export async function getRagTotals(ctx) {
  const r = (await ctx.all(
    `SELECT COUNT(*) AS chunks,
            SUM(CASE WHEN status IN ('EMBEDDED','LIVE') THEN 1 ELSE 0 END) AS embedded,
            SUM(CASE WHEN provision_id IS NOT NULL THEN 1 ELSE 0 END) AS linked
     FROM rag_chunks WHERE status <> 'REJECTED'`
  ))[0] ?? {};
  const jobs = (await ctx.all('SELECT COUNT(*) AS n FROM rag_ingest_jobs'))[0] ?? {};
  return { chunks: Number(r.chunks ?? 0), embedded: Number(r.embedded ?? 0), linked: Number(r.linked ?? 0), jobs: Number(jobs.n ?? 0) };
}

// Deterministic manifest idempotency key: sha256 of the canonical (sorted-key)
// JSON of the manifest object — re-runs of the same manifest are no-ops (RAG-16).
export function manifestHash(manifest) {
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
    }
    return v;
  };
  return sha256Hex(JSON.stringify(canon(manifest)));
}
