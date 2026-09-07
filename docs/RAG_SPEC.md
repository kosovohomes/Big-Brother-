# Self-Hosted RAG Architecture for Kuwaiti Laws — Design Specification

**Status:** DESIGN ONLY (no code in this change). Version 1.0 — 2026-09-07.
**Governing constraint:** this RAG layer is a *corpus + retrieval* layer feeding the existing
`LegalProvision` table and the `resolveRef` grounding contract — **not** a parallel citation system.

---

## 0. Verified Baseline (read before design — every claim below was checked in code)

| # | Fact | Source |
|---|------|--------|
| B1 | `LegalProvision` already carries the full version chain: `amendmentVersion` (default `"original"`), `effectiveFrom`, `effectiveTo` (null = current), `gazetteRef`, `version`, `supersedesId` (self-relation `"provisionVersions"`), `isActive`, `verified` (default `false`), `verifiedBy/verifiedAt`, `@@unique([lawId, articleNo, version])` | `prisma/schema.prisma:111–146` |
| B2 | Grounding contract: `resolveRef({lawId, article}, provisions)` → exact match, then range-part containment; unresolved ⇒ `{resolved:false, verified:false, label:"غير مُتحقق منه — لا يُعرض كاستشهاد"}`; `resolveAll` maps rule refs through the same gate. Engine is a **pure function** — caller supplies provisions | `src/lib/engine.ts:36–64`, header `engine.ts:1–11` |
| B3 | Normalizer/stemmer used by search: `normalizeAr` (tashkeel strip, ٠-٩→0-9, أإآٱ→ا, ؤ→و, ئ→ي, ة→ه, ى→ي), `stemAr` (ال-strip ≥3 stem, و-strip, conservative suffixes), `STOPWORDS`, `buildIndex`, `bm25Score` (k1=1.5, b=0.75) — idempotent on index and query sides | `src/lib/arabic.ts:13–95` |
| B4 | `/api/search` builds an **in-memory BM25 index per request** over `getAllActiveProvisions()` and returns `verified/version/gazetteRef` in results | `src/app/api/search/route.ts:18–49` |
| B5 | Citation validator `/api/kb/resolve`: exact → range match; unresolved is **never displayed as a citation** (hallucination guard) | `src/app/api/kb/resolve/route.ts:16–41` |
| B6 | Phase 0 lawyer audit queue: read for all members, `canVerify = role === 'LAWYER'`; actions `verify` (requires note + gazetteRef), `amend` (publishes v+1, sets `supersedesId`), `deactivate`, `reactivate` — all logged `kb.audit.*` | `src/app/api/kb/audit/route.ts:21–24`, `scripts/e2e.mjs` §9 |
| B7 | Seeded corpus: `corpus.json` (34 entries, short keys `law/article`) + `family.json` (14 entries, DB keys `lawId/articleNo`) = **48 provisions**, seeded with `amendmentVersion='original'`, `effectiveFrom/effectiveTo/gazetteRef = NULL`, `verified=false` | `src/lib/seed-data/*.json`, `scripts/seed.mjs:13–14,37` |
| B8 | Laws in corpus: 38/1980 (CPL), 67/1976 (Civil Code art. 172), 17/1960 (CrCL), 16/1960 (Penal), 9/2020 (repo name: قانون التبليغات الإلكترونية), CITRA P-1/P-2, 51/1996 (PSL, from family.json) | `corpus.json`, `family.json` |
| B9 | Decree-Law 80/2026: *intentionally absent everywhere until verified* (PRD Change 4) | `README.md:17` |
| B10 | e2e baseline: **exactly 98 `check()` calls** (99 `check(` occurrences − 1 definition), all passing | `scripts/e2e.mjs` |
| B11 | Postgres migration, tenant RLS, envelope encryption, MinIO object storage are specced in the Phase A spec (Task 8) — the RAG stack **consumes** those targets (Postgres 16 + pgvector, MinIO) rather than introducing competing infrastructure | `docs/PHASE_A_SPEC.md` (A1/A3) |

---

## 1. Corpus & Sources (authorized only)

### 1.1 Source hierarchy (per chunk, the canonical source is always recorded)

| Rank | Source | Role | Stored metadata |
|------|--------|------|-----------------|
| 1 | **Al-Kuwait Al-Yawm** (الكويت اليوم) official gazette | **Canonical text.** Laws enter into force on publication; every chunk carries the gazette issue + date | `gazetteIssue`, `gazetteDate`, `gazettePage`, `sourceSha256` |
| 2 | **moj.gov.kw** consolidated texts | Cross-check/consolidation reference only — never authoritative for verbatim text | used to validate OCR and to detect consolidation drift; differences are queued for lawyer review |
| 3 | **e.gov.kw** Legislation & Laws | Secondary convenience mirror | same as above |
| 4 | **National Assembly** (kna.kw) | Legislative history (bills, committee reports, debates) → stored as *context documents*, **never** as `LegalProvision` rows | separate `docType=history` in ingest manifest |

### 1.2 Hard rule — permissioned ingestion only
No scraping behind authentication, ever. Ingestion is operator-driven: the operator drops
gazette PDFs/texts into a watched directory **with a signed manifest** and the pipeline runs.
CLI (design): `node scripts/rag-ingest.mjs --scan var/rag/inbox --job <manifest-id>`.
Schema: `docs/rag/schemas/manifest.schema.json` (`law_id`, `issue_no`, `publish_date`,
`source_path`, `sourceSha256`, operator attestation). Idempotency key = `manifestHash`
(sha256 of canonical manifest) — re-runs are no-ops (e2e RAG-16).

### 1.3 Initial corpus scope (maps to B8 lawIds; nothing guessed)

| Law | lawId | Status in repo |
|-----|-------|----------------|
| Code of Civil & Commercial Procedure 38/1980 | `38/1980` | seeded (15 provisions) |
| Code of Criminal Procedure 17/1960 | `17/1960` | seeded (7) |
| Penal Code 16/1960 | `16/1960` | seeded (6) |
| Personal Status Law 51/1996 | `51/1996` | seeded (14, family.json) |
| Electronic Service Law 9/2020 | `9/2020` | seeded (3) — repo naming preserved; exact gazette identity pinned at lawyer verification |
| Civil Code 67/1976 (art. 172 limitation) | `67/1976` | seeded (1) |
| **Evidence Law (قانون الإثبات)** | `EVID/<year>` placeholder | **new** — the exact number/year is fixed by the first gazette manifest, never hardcoded |
| All amendments | from gazette manifests | amendment-linkage records (§2.4) |
| **Decree-Law 80/2026** | — | **EXCLUDED — ingestion blocklist.** Preserved per `README.md:17` (PRD Change 4); becomes eligible only after lawyer verification. e2e RAG-15 asserts the block |

---

## 2. Ingestion Pipeline

### 2.1 State machine (per `IngestJob`; per-chunk states in §2.5)
```
DISCOVERED → BLOCKED_POLICY? ──► terminal (80/2026 or unlisted law)
           → OCR_QUEUED → OCR_DONE ─┬─► OCR_REVIEW (low confidence, human fixes pages)
                                    └─► CLEANED → CHUNKED → LINKED → QA
                                                → LAWYER_REVIEW → EMBEDDED → INDEXED → LIVE
           → REJECTED (any gate failure, with reason)
```
Transitions are recorded on the job row (`status` + `stats` JSON) and mirrored to `AuditLog`
(`action = 'rag.ingest.*'`) so corpus changes are auditable like every other action.

### 2.2 OCR — two self-hostable options with tradeoffs

| | Option A (primary): **PaddleOCR** (PP-OCRv4/v5 multilingual, Arabic) | Option B (fallback): **Tesseract 5 `ara`** |
|---|---|---|
| Accuracy on printed gazette Arabic | High — better ligature/hamza handling out of the box | Moderate — needs ≥300 DPI, deskew, binarization preprocessing to be acceptable |
| Footprint | Python runtime + Paddle ~0.5–1 GB image; GPU optional | ~50 MB language pack; trivially CI-able |
| Confidence output | Per-line/per-page scores | Per-word confidences |
| Fit | Default engine for gazette scans | Fallback, and for text-born PDFs it is skipped entirely |

**Quality checklist (gate `OCR_DONE → CLEANED`):** ≥300 DPI render; grayscale + deskew;
Arabic OSD verified (no upside-down pages); per-page mean confidence **≥ 0.85** and
article-anchor density sanity (a gazette page of a law must contain ≥1 `المادة` anchor unless
it is a continuation page); failure ⇒ chunk/page routed to `OCR_REVIEW`, never to LIVE (e2e RAG-18).

### 2.3 Cleaning & normalization — one spec, two implementations
Store **two texts per chunk**: `textCanonical` (verbatim gazette text — display and LLM
injection) and `textNormalized` (indexing/embedding). Normalization **reuses the `arabic.ts`
spec** (B3) as a Python port, locked by shared conformance vectors (fixtures run against both
`normalizeAr` and the port in CI) so index-side and query-side normalization can never drift.
Canonical keeps Arabic-Indic numerals and diacritics; normalized folds them exactly like
`normalizeAr`. Dedup key: `sha256(lawId|articleNo|articlePart|textNormalized)` (e2e RAG-16).

### 2.4 Article-anchored chunking + amendment linkage
- Chunk = **one article** (or article-paragraph when an article exceeds ~1200 chars → `articlePart` sequence).
- Anchor regex: `المادة\s*\(?([٠-٩0-9]+)(?:\s*[–—-]\s*([٠-٩0-9]+))?\)?`; chapter/section headings
  captured from preceding `الباب/الفصل` lines → `chapterHeading`.
- Chunk metadata (schema in `docs/rag/schemas/chunk.schema.json`): `law_id, article_no,
  article_part, chapter_heading, amendment_version, effective_from, effective_to, gazette_ref
  {issue, date, page}, page, ocr{engine, confidence}, text_hash, status`.
- **Amendment detection:** the chunker scans for statutory amendment formulas and emits
  `ProvisionAmendment` records — never silently rewriting text:

| Pattern (Arabic) | Action |
|---|---|
| «يُستبدل/تُستبدل … النص/العبارة … بالآتي» | `REPLACE` |
| «يُضاف/تُضاف المادة (X) [المكرر] إلى القانون رقم (Y)» | `INSERT` |
| «تُلغى/يُلغى المادة (X) من القانون رقم (Y)» | `REPEAL` |
| «يُعدَّل المادة (X) … لتصبح على النحو الآتي» | `RESTATE` |
| «يُنقل/يُدمج/يُعاد ترقيم …» | `RENUMBER` |
| «تُلغى أحكام كل نص يخالف …» (general repeal clause) | `GENERAL_REPEAL` — recorded, **not** auto-applied (needs lawyer mapping) |

- **Application (lawyer-gated):** applying a `REPLACE/RESTATE/INSERT` amendment **never overwrites
  history** — it creates a new `LegalProvision` row (`version+1`, `effectiveFrom = publishDate`,
  `supersedesId = old.id`) and closes the old row (`effectiveTo = publishDate`, `isActive = false`).
  This is exactly the version-chain mechanism `amend` already uses in `kb/audit` (B6) and the
  schema comment "superseded rows kept (never overwritten)" (B1) — the pipeline drives it
  automatically, the lawyer approves it in review. Expiry semantics match the retrieval filter in §4.2
  (`effective_to > query_date` ⇒ the old text remains valid for every day strictly before publication).

### 2.5 Quality gates
1. OCR confidence gate (§2.2) — per document and per page.
2. Normalization conformance vectors green (§2.3).
3. Dedup on `textHash`; conflicting duplicate text for the same `(lawId, articleNo, version)` ⇒ `REJECTED` with reason.
4. Law allowlist/blocklist: only gazette-manifested laws; **80/2026 hard-blocked** (RAG-15).
5. **`verified:false` by default** — every pipeline-created provision enters the existing Phase 0
   audit queue (`/api/kb/audit`, B6) and is displayed with the existing unverified badge until a
   lawyer signs off with note + gazetteRef (unchanged display rule from B5/B6).

---

## 3. Embeddings + Vector Store (all local; no external embedding API may receive any text)

### 3.1 Embedding model — two self-hostable, Arabic-capable candidates

| | **BAAI/bge-m3** (pick) | **intfloat/multilingual-e5-large** (runner-up) |
|---|---|---|
| License / dims / context | MIT · 1024-d dense + learned sparse · **8192 tokens** | MIT · 1024-d · 512 tokens |
| Arabic retrieval | ~0.70 nDCG@10 on MIRACL-ar (among the strongest open dense models); native hybrid dense+sparse output | ~0.65 MIRACL-ar; dense-only |
| Why it fits | Whole long articles fit in one pass (gazette articles are 100–1500 tokens); sparse head boosts exact article-number matching | Strong baseline, but 512 ctx forces splitting long articles |
| Serving | **HF Text Embeddings Inference (TEI)** container; ~2 GB GPU or 8 vCPU (~200–400 ms/batch-16) | same |

**Pre-lock-in benchmark protocol** (run before finalizing): MIRACL-ar, Mr. TyDi-ar, ArabicMTEB
retrieval subset, **plus** the in-house gold set (§6). Report nDCG@10 / Recall@20 / MRR@10 and
P95 latency per query. Acceptance: dense ≥ BM25-only +10% nDCG@10 on the gold set, else ship
BM25-only and revisit. All inference runs inside the deployment network — enforced at compose
level (`internal: true` network, no egress) and asserted by e2e RAG-14/18 stubs.

### 3.2 Vector store — two candidates

| | **pgvector on Postgres 16** (pick) | **Qdrant** (scale-out path) |
|---|---|---|
| Fit | Same DB as `LegalProvision` ⇒ **transactional** version flips + chunk indexing; temporal filters as plain SQL `WHERE`; one service fewer; aligns with the Phase A Postgres migration (B11) | Rust HNSW, named dense+sparse vectors, rich payload filters; better beyond ~10⁶ vectors / ColBERT reranking |
| Hybrid | Postgres FTS tsvector (pre-normalized tokens, `simple` config) + RRF fusion; optional ParadeDB `pg_search` for true BM25 scoring | native sparse + dense fusion |

**Decision:** at this corpus scale (~10⁴–10⁵ chunks) pgvector HNSW serves <10 ms/query and
correctness-of-filtering matters more than scale — pick **bge-m3 + pgvector**, keep Qdrant behind
the same `RagRetriever` interface as a documented scale-out path (compose profile `qdrant`).
**Hardware:** dev = CPU-only 16 GB; prod reference = 1×24 GB GPU (A10/RTX 4090) hosting
TEI (~2 GB) + Qwen2.5-14B-AWQ (~11 GB) with headroom; CPU-only prod fallback = Ollama
Qwen2.5-7B Q4 (~6 GB) at reduced throughput.

---

## 4. Retrieval API

### 4.1 New persistence (Prisma — additive; **zero changes to existing models**)

```prisma
model RagChunk {
  id             String   @id @default(cuid())
  provisionId    String?                        // set when linked to LKB
  lawId          String                         // "38/1980"
  articleNo      String                         // "163"
  articlePart    Int      @default(1)
  chapterHeading String?
  amendmentVersion String @default("original")
  effectiveFrom  DateTime?
  effectiveTo    DateTime?
  gazetteIssue   String?
  gazetteDate    DateTime?
  gazettePage    Int?
  textCanonical  String
  textNormalized String
  textHash       String                         // sha256(normalized) — dedup + grounding check
  ocrEngine      String?
  ocrConfidence  Float?
  ingestJobId    String
  status         String   @default("CHUNKED")   // CHUNKED|LINKED|QA_PASS|LAWYER_REVIEW|EMBEDDED|INDEXED|LIVE|REJECTED
  // pgvector(1024) column added via raw SQL on Postgres (Prisma Unsupported);
  // SQLite dev/test fallback stores a JSON array — retrieval SQL lives in the Phase A driver
  createdAt      DateTime @default(now())
  @@unique([lawId, articleNo, articlePart, textHash])
  @@index([lawId, articleNo])
}

model ProvisionAmendment {
  id              String   @id @default(cuid())
  amendingLawId   String                 // e.g. "15/2025"
  amendingArticle String?
  targetLawId     String                 // "38/1980"
  targetArticle   String                 // "163"
  action          String                 // REPLACE|INSERT|REPEAL|RENUMBER|RESTATE|GENERAL_REPEAL
  gazetteIssue    String?
  gazetteDate     DateTime?
  newProvisionId  String?                // populated when applied (version+1 row)
  appliedAt       DateTime?
  detectedBy      String   @default("pipeline")
  approvedBy      String?                // lawyer gate before application
  createdAt       DateTime @default(now())
  @@index([targetLawId, targetArticle])
}

model IngestJob {
  id           String   @id @default(cuid())
  manifestHash String   @unique        // idempotency (RAG-16)
  issueNo      String
  publishDate  DateTime
  sourcePath   String
  sourceSha256 String
  status       String   @default("DISCOVERED")
  ocrEngine    String?
  stats        String?                 // JSON: pages, chunks, lowConfPages, gates
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model RagQueryLog {
  id        String   @id @default(cuid())
  orgId     String?                // org-scoped; **query text is never stored** (case-data hygiene)
  queryHash String                 // sha256(normalized query)
  latencyMs Int?
  createdAt DateTime @default(now())
  @@index([orgId])
}
```

`LegalProvision` needs **no migration** (B1 already contains everything). Seeded 48 keep
`effectiveFrom = NULL` until Phase 0 lawyers confirm dates (B7) — hence the NULL semantics in §4.2.

### 4.2 Hybrid search semantics
Pipeline: normalize query with `arabic.ts` parity tokens → **(a)** BM25 over Postgres FTS
tsvector of `textNormalized` (+ `LegalProvision.textAr` for provision-side matches),
**(b)** dense kNN over `RagChunk.embedding` (bge-m3 via TEI) → **RRF (k=60)** fusion →
ts_headline snippets.

**Mandatory temporal filter (applied BEFORE scoring, never as a post-filter):**
```sql
(law_id = ANY(:laws))                                   -- optional law filter
AND (effective_from IS NULL OR effective_from <= :query_date)
AND (effective_to   IS NULL OR effective_to   >  :query_date)
AND is_active = TRUE
```
`effectiveFrom IS NULL` (the seeded-48 state, B7) means *"current text pending Phase 0 dating"* —
retrievable and badged, so the filter can never silently empty the corpus. **Superseded articles
are retrievable ONLY with an explicit flag:**
`GET /api/rag/search?q=…&asOf=2026-09-07&versions=current|historical|all` —
`current` (default) = active versions only; `historical` = returns the `supersedesId` chain
(each hit carries its full validity window); `all` = both. `asOf` defaults to today (UTC).
(e2e RAG-04…RAG-09 pin every branch of this table.)

### 4.3 Response contract (superset of `/api/search`'s shape, B4)
```json
{
  "query": "…", "asOf": "2026-09-07", "versions": "current",
  "results": [{
    "provisionId": "cuid", "chunkId": "cuid", "lawId": "38/1980",
    "articleNo": "163", "version": 2, "amendmentVersion": "original",
    "effectiveFrom": "…", "effectiveTo": null,
    "gazetteRef": {"issue": "…", "date": "…", "page": 42},
    "snippet": "…", "score": 0.87, "verified": false
  }]
}
```
**Consumption path — the anti-hallucination guarantee is unchanged:** `/api/rag/search` is a
*proposer*. It never renders text as a citation; consumers feed `{lawId, article}` into the
existing `resolveRef` (B2) or `/api/kb/resolve` (B5), which re-read the LKB. `LegalProvision`
remains the single citation source of truth; a RAG hit that fails to resolve is displayed exactly
like any unresolved ref — never as a citation (e2e RAG-10).

### 4.4 Endpoints

| Endpoint | Authz | Purpose |
|---|---|---|
| `GET /api/rag/search` | any authenticated member (`requireOrg` — same org gate as `/api/search`, B4) | user-facing hybrid search |
| `POST /api/rag/ingest` | **LAWYER/ADMIN only** — same role gate as `kb/audit` `canVerify` (B6); accepts a manifest + `dryRun` flag | scans inbox / applies a gazette issue |
| `GET /api/rag/status` | authenticated | corpus coverage per law (articles ingested / expected, amendment counts), queue depth, Phase 0 progress (parity of `getAuditStats`) |

---

## 5. Grounded LLM (self-hosted)

### 5.1 Model & serving
- **Primary:** `Qwen2.5-14B-Instruct-AWQ` on **vLLM** (OpenAI-compatible API, internal network
  only) — Apache-2.0, strong Arabic; ~11 GB on the 24 GB reference GPU.
- **Dev/CPU fallback:** `Qwen2.5-7B-Instruct` Q4_K_M via **Ollama** (~6 GB).
- **Arabic-first alternative:** ALLaM-7B (license review required before adoption — decision left open).
- `LLM_PROVIDER = vllm | ollama | off` (default `off` — behavior today is unchanged until enabled).

### 5.2 Layer-2 draft generation only — mirroring `resolveAll`
The LLM is a **drafting aid for Layer-2 "Discussion Draft" payloads** (via `packs.ts`), never a
bypass of the engine. Prompt template injects retrieved provisions **verbatim** (`textCanonical`)
with `provisionId/version/effective dates` and instructs the model to tag every sentence with
`[P:<provisionId>]`. A post-generation validator (design: `src/lib/rag/trace.ts`) then:

1. splits the draft into sentences;
2. for each sentence: ≥1 marker ⇒ resolve the provision (exact `provisionId`, not fuzzy) and
   verify the sentence's quoted/paraphrased basis by normalized containment against
   `textAr` (reusing `normalizeAr`, B3) ⇒ emit
   `trace {provisionId, extractedText, evidenceHash = sha256(provisionId|version|textAr)}`;
3. any sentence without a valid trace is marked **unverified** — the engine's display rule
   (unresolved ⇒ never shown as a citation, B2) applies unchanged.

The output then passes the **existing, unchanged Layer-2 gates**: acknowledgment (428 without ack),
24 h cooling-off for misconduct/nazaha (423), NGO review queue (`IN_REVIEW`, lawyer release),
unverified badges (all proven by e2e §6/§7 today; RAG-14 re-proves them on the LLM path).

### 5.3 External LLM APIs — forbidden for case data
`EXTERNAL_LLM_ENABLED` (default **OFF**). When explicitly enabled, it is allowed **only** for
anonymized rule-text tasks (e.g., summarizing `rules/catalog.ts` text) through an anonymizer that
strips case fields, names, org identifiers; the outbound payload allowlist is asserted by e2e
RAG-14. No case data ever leaves the deployment — all embedding/LLM inference is local (§3.1/§5.1).

---

## 6. Evaluation

### 6.1 Gold benchmark set — 100 Arabic legal questions
Schema: `{qid, question, queryDate, goldProvisionIds[], type, source}` with distribution:
40 direct article lookup · 25 concept→article · 20 scenario→articles · 15 cross-law/temporal.
Construction: seeded 48 provisions (B7) + newly ingested **lawyer-verified** chunks; every gold
answer is a real `provisionId` resolvable through `resolveRef`.

### 6.2 Targets (acceptance gates, run by `scripts/rag-eval.mjs` — same pattern as `e2e.mjs`)

| Metric | Target |
|---|---|
| Citation accuracy (cited ids resolve via `resolveRef` ⊇ gold, zero fabricated ids) | **≥ 95%** |
| Superseded-article retrieval for current-law questions (`versions=current`) | **0 leaks** |
| Retrieval latency P95 (query→results, embedding included, target hardware) | **< 2 s** |
| Grounding-trace coverage (every generated sentence traced or flagged) | 100% |

CI runs the retrieval-only suite (no GPU required); the full LLM suite runs on the target box.
Reports land in `var/rag/eval/` as JSON artifacts.

---

## 7. Constraints & Conflict Register (flagged, not assumed)

**Constraints (from the brief, all preserved):** no case data ever leaves the deployment ·
`LegalProvision` remains the single citation source of truth · `verified:false` defaults preserved ·
history is append-only (`supersedesId` chain; superseded rows never overwritten — B1).
`engine.ts` untouched by design (B2).

| # | Finding | Disposition |
|---|---|---|
| C-R1 | e2e baseline is **exactly 98** `check()` calls (B10) — earlier session notes claiming "39" were stale | corrected here; RAG additions numbered independently RAG-01…RAG-18 → 116 |
| C-R2 | Seed JSONs use two different shapes (`corpus.json` short keys vs `family.json` DB keys, B7) | RAG ingest **never** reads seed JSONs; it writes through the DB path only — seed files remain dev fixtures |
| C-R3 | Brief's "Law 9/2020" is named قانون التبليغات الإلكترونية (Electronic Service Law) in the corpus (B8) | repo naming preserved; exact gazette identity pinned during lawyer verification |
| C-R4 | "Evidence Law" is **absent** from the current corpus (evidence topics come from CPL/Penal articles) | new `lawId` placeholder `EVID/<year>`, fixed by the first manifest — never guessed |
| C-R5 | `/api/search` builds an in-memory BM25 index per request (B4) — O(N) per request, fine at 48, unacceptable at 10⁵ chunks | `/api/rag/search` uses persisted indexes (Postgres FTS + pgvector); `arabic.ts` reused for normalization parity only |
| C-R6 | `/api/kb/stats` uses raw SQLite-dialect SQL (`db.prepare`) | pattern note for Phase A driver translation; `/api/rag/status` must use the facade, not raw SQL |
| C-R7 | Version-chain fields **already exist** on `LegalProvision` (B1) | RAG work is purely additive (4 new tables); no destructive migration; the 98 existing checks are untouched at schema level |
| C-R8 | `resolveRef` range matching is substring-containment (B2) | RAG returns exact `provisionId`s; grounding re-resolves through `resolveRef` — no engine change permitted |
| C-R9 | `kb/audit` `amend` already publishes v+1 with `supersedesId` (B6) | the amendment linker (§2.4) reuses this exact mechanism, machine-driven but lawyer-gated |
| C-R10 | Seed rows have `effectiveFrom = NULL` (B7) — a strict `effective_from <= :q` filter would hide all 48 | filter semantics defined in §4.2: NULL dates = "current, pending Phase 0 dating" (retrievable + badged) |

---

§7 deliverables (docker-compose, machine-readable schemas, ingestion state machine + runbook,
numbered e2e additions) → **`docs/rag/DELIVERABLES.md`** + `docs/rag/schemas/*.json` +
`docs/rag/docker-compose.rag.yml`.
