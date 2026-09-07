-- =====================================================================
-- RAG Phase 1 (docs/RAG_SPEC.md §4.1) 007_rag.sql — additive corpus/
-- retrieval tables, mirroring src/lib/sqlite.mjs DDL 1:1 (TEXT ISO dates,
-- SMALLINT booleans — same v1 conventions as 002_tables.sql).
--
-- These are GLOBAL corpus tables (no org_id → no RLS policies; access is
-- grant-scoped like the global legal_provisions read path, C-A9). Writes
-- come from the ingest pipeline (LAWYER/ADMIN via the API, or the CLI via
-- bb_system); reads from any authenticated member.
-- =====================================================================

CREATE TABLE IF NOT EXISTS rag_ingest_jobs (
  id TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL UNIQUE,   -- idempotency key (RAG-16)
  issue_no TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'txt',
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  attested SMALLINT NOT NULL DEFAULT 0,
  ocr_engine TEXT,
  stats TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  provision_id TEXT,                    -- pointer to the LKB (read-only linkage)
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
  embedding TEXT,                       -- JSON array on both backends in Phase 1;
                                        -- pgvector(1024) migration is Phase R0 (deferred)
  ocr_engine TEXT,
  ocr_confidence REAL,
  ingest_job_id TEXT NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
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
  action TEXT NOT NULL,                 -- REPLACE|INSERT|REPEAL|RENUMBER|RESTATE|GENERAL_REPEAL
  gazette_issue TEXT,
  gazette_date TEXT,
  new_provision_id TEXT,
  applied_at TEXT,
  detected_by TEXT NOT NULL DEFAULT 'pipeline',
  approved_by TEXT,                     -- lawyer gate before any application
  ingest_job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prov_amend_target ON provision_amendments(target_law_id, target_article);

CREATE TABLE IF NOT EXISTS rag_query_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,                          -- org-scoped; query TEXT IS NEVER STORED
  query_hash TEXT NOT NULL,             -- sha256(normalized query)
  latency_ms INTEGER,
  embed_mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rag_query_log_org ON rag_query_log(org_id);

-- Least-privilege grants: bb_app reads the corpus and (via the LAWYER/ADMIN
-- ingest route) writes jobs/chunks; bb_system has full control (CLI ingests).
GRANT SELECT, INSERT, UPDATE ON rag_ingest_jobs TO bb_app;
GRANT SELECT, INSERT, UPDATE ON rag_chunks TO bb_app;
GRANT SELECT, INSERT ON provision_amendments TO bb_app;
GRANT SELECT, INSERT ON rag_query_log TO bb_app;
GRANT ALL ON rag_ingest_jobs TO bb_system;
GRANT ALL ON rag_chunks TO bb_system;
GRANT ALL ON provision_amendments TO bb_system;
GRANT ALL ON rag_query_log TO bb_system;
