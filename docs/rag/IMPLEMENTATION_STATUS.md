# RAG Phase 1 — Implementation Status

Read this before assuming anything about what the RAG layer does and does not
do. Design source: `docs/RAG_SPEC.md` + `docs/rag/DELIVERABLES.md`. Task brief:
the "Integrate Kuwait Ministry of Justice laws into Big Brother's RAG pipeline"
harness (uploaded 2026-09-07).

## Implemented (Phase 1)

| Area | What exists | Where |
|---|---|---|
| Ingestion pipeline | Manifest v1 validation → sha256 integrity → policy blocklist → article-anchored chunking → LINKED (read-only pointer to the LKB) → EMBEDDED (local-only) → job terminal. State machine, stats, `rag.ingest.*` audit rows | `src/lib/rag/pipeline.mjs` |
| Chunker | One chunk = one article (`المادة (N)` anchors, line-anchored + inline fallback), مكرر variants, chapter headings (`الباب/الفصل`), `articlePart` split >1200 chars on paragraph/sentence boundaries. `chunks: 0` ⇒ job REJECTED — parsing failures are never papered over | `src/lib/rag/chunker.mjs` |
| Chunk-level version chain | Re-ingesting a newer text for the same (law, article, part) closes the old chunk's window (`effective_to = new publishDate`). Append-only: text rows are never mutated/deleted | `store.mjs` + e2e RAG-04..08 |
| Persistence | 4 additive tables on BOTH backends (`rag_ingest_jobs`, `rag_chunks`, `provision_amendments`, `rag_query_log`) — SQLite DDL in `sqlite.mjs`, Postgres `scripts/pg/007_rag.sql` (+grants, applied by `setup-embedded.mjs`), Prisma documented models | additive; no existing table touched |
| Retrieval | Hybrid: BM25 (k1=1.5 b=0.75, shared `arabic.mjs` tokenization, per-process cached index invalidated on ingest) + optional dense kNN (cosine) fused by RRF (k=60). Temporal filter applied in SQL BEFORE scoring. `versions=current|historical|all`, `asOf` | `src/lib/rag/retriever.mjs` |
| Embeddings | Local-only Ollama-compatible client (`/api/embeddings` then `/v1/embeddings`), bounded concurrency, graceful degradation to lexical-only with `meta.embedMode` telling the consumer which path served | `src/lib/rag/embed.mjs` |
| API | `GET /api/rag/search` (any member), `POST /api/rag/ingest` (LAWYER/ADMIN; dryRun supported; source read confined to `RAG_INBOX`), `GET /api/rag/status` (coverage, jobs, Phase 0 parity, blocklist) | `src/app/api/rag/*` |
| CLI | `scripts/rag-ingest.mjs` (--manifest/--scan, --dry-run, dual-backend), `scripts/rag-build-inbox.mjs` (deterministic corpus→inbox builder) | scripts |
| Consumer | "Related laws" panel on the case view — retrieval proposals with unverified badges, each hit resolvable through `/api/kb/resolve` before any citation display | `src/components/app/panels/RelatedLaws.tsx` |
| Blocklist | Decree-Law 80/2026 hard-blocked at pipeline AND route level (`BLOCKED_POLICY`, terminal). Never removed or weakened | `store.mjs` (single source) |
| e2e | Section [15]: RAG-01..RAG-10, RAG-13 (engine-contract half), RAG-15..RAG-18 + tamper/refusal policy | `scripts/e2e.mjs` |

## Explicitly NOT implemented (deferred — do not assume otherwise)

- **OCR / scanned PDFs / `sourceType: "pdf"`** — manifests with `sourceType`
  "pdf" are rejected at validation. Phase 1 consumes plain `txt` only.
- **pgvector / Postgres FTS** — embeddings (when an embed service exists) are
  stored as JSON arrays; dense scoring runs in-process. The `vector(1024)`
  column + HNSW + tsvector path is the Phase R0 migration.
- **LLM answer generation / grounding trace (`trace.ts`)** — `LLM_PROVIDER=off`
  by design for now; e2e RAG-11/12/14 ship with that phase. The engine's
  contract half of RAG-13 (fabricated id unresolved) is asserted today.
- **EXTERNAL_LLM_ENABLED path** — no external LLM code exists; nothing to
  assert beyond its absence.
- **Amendment APPLICATION** — `ProvisionAmendment` records are written
  (detection only). Applying them (new v+1 provision rows) stays lawyer-gated
  via the existing kb/audit flow.
- **Chunk deactivation API** — `is_active` exists; the operator route comes
  with the Phase 0 chunk-verification workflow.
- **Superseded-chain retrieval driven by LKB rows** — Phase 1 chains operate on
  chunk windows; the provision-level `supersedesId` chain remains the citation
  authority via resolveRef.

## Documented deviations from the harness/design text (all deliberate)

1. **`manifestVersion` is `"1"`, not `"1.0"`** — the repo schema
   (`manifest.schema.json`) pins `const "1"`; the harness example predates it.
2. **`attestation: false` is allowed** — the original schema had
   `const: true`, which would force rubber-stamping mirror-class sources. The
   schema now accepts a boolean: `false` = provisional source ⇒ job can never
   reach INDEXED/LIVE and every hit is flagged `provisionalSource`. The real
   Kuwait corpus in this repo (`corpus/SOURCES.json`) is mirror-class, so the
   inbox drops are built with `attestation: false` — honest by construction
   (`scripts/rag-build-inbox.mjs`).
3. **`RAG_ENABLED` defaults to `true`** — the DELIVERABLES env matrix said
   `false`; the operative harness requires the feature reachable. The flag
   remains as a rollback switch (`RAG_ENABLED=false` ⇒ 503).
4. **`issueNo`/`publishDate` on mirror drops are mirror-snapshot metadata**
   (`MIRROR-<lawId>`, snapshot date), never presented as the gazette identity —
   pinning that is the lawyer's Phase 0 job.

## Verified environment notes

- Sandbox has no Ollama: chunks ingest with `embedding=null`, status
  `CHUNKED`, and `/api/rag/search` reports `meta.embedMode: 'lexical'`. The
  dense/RRF path is code-complete and activates automatically when
  `RAG_OLLAMA_HOST` points at a live bge-m3 endpoint.
- **Re-embedding caveat (documented, deferred to R0):** idempotency keys on
  `(law_id, article_no, article_part, text_hash)` mean chunks first ingested
  without an embedder keep `embedding=null` even after an embed service
  appears — a `--reembed` maintenance command ships with Phase R0. Phase 1
  deployments should bring the embedder up before the first ingest.
