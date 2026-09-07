# RAG Deliverables — docker-compose, Schemas, State Machine, Runbook, e2e Additions

Companion to `docs/RAG_SPEC.md` (§7). Design artifacts — wiring into the app happens at
implementation time; the existing 98 e2e checks remain the unchanged compatibility baseline.

---

## 7.1 docker-compose stack (reference file: `docs/rag/docker-compose.rag.yml`)

| Service | Image | Profile | Purpose / notes |
|---|---|---|---|
| `app` | build of repo | core | Next.js app (port 3000) — unchanged; RAG routes behind `RAG_ENABLED` |
| `db` | `pgvector/pgvector:pg16` | core | Postgres 16 + pgvector — **the Phase A A1 target DB**; `RagChunk.embedding vector(1024)` lives here |
| `minio` | `minio/minio` | core | gazette source PDFs + (Phase A A3) document originals; WORM-compatible |
| `tei` | `ghcr.io/huggingface/text-embeddings-inference:cpu-1.6` | core | bge-m3 embedding service; **internal network only, no egress** |
| `ocr-worker` | custom `Dockerfile.ocr` (PaddleOCR primary, Tesseract `ara` fallback) | ocr | watches `RAG_INBOX`, runs the §2 state machine |
| `ollama` | `ollama/ollama` | cpu-llm | CPU LLM fallback (Qwen2.5-7B Q4) |
| `vllm` | `vllm/vllm-openai` | gpu | `Qwen/Qwen2.5-14B-Instruct-AWQ`, `--max-model-len 8192`, GPU reservation |
| `qdrant` | `qdrant/qdrant` | qdrant | documented alternative vector backend (spec §3.2) |

Networks: `frontend` (app) and `internal` (`internal: true` — db, minio, tei, ollama, vllm,
qdrant). Inference services cannot reach the internet ⇒ *no text can leave the deployment*.

**Env/config matrix (defaults reproduce today's behavior):**

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | existing | Phase A: Postgres URL; today: SQLite |
| `RAG_ENABLED` | `false` | master switch; `false` = no RAG routes registered |
| `EMBED_PROVIDER` / `EMBED_MODEL` / `EMBED_DIM` | `tei` / `BAAI/bge-m3` / `1024` | embedding service |
| `VECTOR_BACKEND` | `pgvector` | or `qdrant` (profile) |
| `LLM_PROVIDER` / `LLM_MODEL` | `off` / `Qwen/Qwen2.5-14B-Instruct-AWQ` | Layer-2 drafting |
| `EXTERNAL_LLM_ENABLED` | `false` | anonymized rule-text tasks only (spec §5.3) |
| `RAG_INBOX` | `/data/gazette/inbox` | operator drop directory |
| `OCR_ENGINE` / `OCR_MIN_CONFIDENCE` | `paddle` / `0.85` | §2.2 gate |
| `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY` | — | object storage |

---

## 7.2 Corpus manifest schema → `docs/rag/schemas/manifest.schema.json`
Key fields: `manifestVersion:"1"`, `issueNo`, `publishDate` (ISO date — becomes `gazetteDate` and
`effectiveFrom` on every chunk), `sourceType: pdf|txt`, `sourcePath`, `sourceSha256` (64-hex),
`laws[] {lawId, lawNameAr, expectedArticleCount?, scopeNotes?}`, `operator {name, attestation:true}`,
`notes?`. Idempotency: `manifestHash = sha256(canonical JSON)` unique on `IngestJob`.

## 7.3 Chunk schema → `docs/rag/schemas/chunk.schema.json`
Key fields: `lawId`, `articleNo`, `articlePart ≥1`, `chapterHeading?`, `amendmentVersion`,
`effectiveFrom/effectiveTo?`, `gazetteRef {issueNo, publishDate, page?}`, `textCanonical`,
`textNormalized`, `textHash` (64-hex), `ocr {engine, confidence 0–1}?`, `provisionId?`,
`status` enum, `supersedesId?`, `reviewedBy?`, `createdAt`.

## 7.4 Ingestion state machine (normative)
```
DISCOVERED ─┬─► BLOCKED_POLICY            (80/2026 or law not on allowlist — terminal)
            ├─► OCR_QUEUED → OCR_DONE ─┬─► OCR_REVIEW ─► (operator fixes pages) → CLEANED
            │                          └─► CLEANED
            └─► REJECTED (manifest invalid / sha mismatch)

CLEANED → CHUNKED → LINKED (amendment records emitted) → QA (gates §2.5)
        → LAWYER_REVIEW (verified:false; kb/audit flow B6)
        → EMBEDDED → INDEXED → LIVE                     (success path)
any gate failure → REJECTED {reason}
```
Chunk-level states mirror the job (`RagChunk.status`); transitions append `rag.ingest.*` AuditLog
rows. **No transition ever mutates an existing `LegalProvision` text row** — application of an
amendment only creates the v+1 row and closes the old one (RAG_SPEC §2.4, e2e RAG-17).

## 7.5 Runbook — adding a new gazette issue (operator steps)
1. Obtain the gazette PDF from Al-Kuwait Al-Yawm via the official channel (no auth bypass).
2. Record provenance (source URL, download date) in the issue folder `RAG_INBOX/issue-<no>/`.
3. Compute `sha256` of the source file; verify against the official mirror if available.
4. Create `manifest.json` from `docs/rag/schemas/manifest.schema.json` (lawIds must match
   `LegalProvision.lawId` values or be explicitly new — never guessed).
5. Drop the file + manifest into the inbox; run `node scripts/rag-ingest.mjs --scan $RAG_INBOX --dry-run`.
6. Review the dry-run report (chunks, anchors, OCR confidence histogram).
7. Re-run without `--dry-run`; follow the job in `GET /api/rag/status`.
8. Fix any `OCR_REVIEW` pages (re-scan at ≥300 DPI) and re-run (idempotent by `manifestHash`).
9. Route to lawyer review: new provisions appear in `/api/kb/audit` with `verified:false`.
10. Lawyer approves texts and amendment applications; confirms `effectiveFrom` dates and
    gazette refs (Phase 0 rules — note + gazetteRef mandatory).
11. Confirm amendment-linkage records applied (`ProvisionAmendment.appliedAt` set; old versions closed).
12. Run `scripts/rag-eval.mjs --subset` and the RAG e2e suite; attach the JSON report.
13. Done — corpus coverage updates in `/api/rag/status`.

## 7.6 e2e additions — `scripts/e2e.mjs` (baseline 98 checks; +18 ⇒ 116)

**Ingest authz (3)**
- **RAG-01** MEMBER and CASEWORKER `POST /api/rag/ingest` → **403** (role gate mirrors `kb/audit` `canVerify`).
- **RAG-02** LAWYER (org-switched exactly like e2e §9) ingests a valid manifest → job reaches
  `LAWYER_REVIEW`; every provision created has `verified === false`.
- **RAG-03** `GET /api/rag/status` unauthenticated → **401**.

**Superseded-article retrieval (6)**
- **RAG-04** default `versions=current` search on text that strongly matches a superseded version → superseded id absent.
- **RAG-05** `versions=historical` → superseded chain returned, each hit with `supersedesId` + validity window.
- **RAG-06** `asOf` strictly before the amending issue's publish date → old version returned.
- **RAG-07** `asOf` = publish date → new version returned (inclusive `effective_from`).
- **RAG-08** `asOf` = day before publish date → old version (`effective_to > q` semantics).
- **RAG-09** row deactivated via `kb/audit` (e2e §9 flow) excluded from current retrieval.

**Grounding-trace tests (5)**
- **RAG-10** every search hit's `provisionId` resolves through `/api/kb/resolve` (`resolved:true`) — the RAG layer cannot orphan the grounding contract.
- **RAG-11** sentence with valid `[P:<id>]` marker → trace with `evidenceHash === sha256(provisionId|version|textAr)`.
- **RAG-12** sentence without marker → flagged `unverified`, never displayed as a citation.
- **RAG-13** fabricated provision id in a draft → `resolveRef` unresolved → unverified label (engine contract intact, engine untouched).
- **RAG-14** Layer-2 gates preserved around LLM drafts: ack 428, misconduct cooling-off 423,
  review queue `IN_REVIEW`; with `EXTERNAL_LLM_ENABLED=true` the outbound payload allowlist
  contains no case fields/org ids.

**Corpus policy & integrity (4)**
- **RAG-15** manifest referencing **Decree-Law 80/2026** → job `BLOCKED_POLICY` (README.md:17).
- **RAG-16** re-ingest of the same `manifestHash` → idempotent: zero duplicate provisions
  (`@@unique([lawId, articleNo, version])` respected).
- **RAG-17** amendment application never mutates the old row's `textAr` (hash before == hash after;
  only `effectiveTo`/`isActive` flip; new v+1 row created with `supersedesId`).
- **RAG-18** normalization parity: shared conformance vectors produce identical tokens from
  `arabic.ts` and the pipeline port; plus `RAG_INBOX` text never leaves the internal network
  (embed/LLM services unreachable from outside — compose `internal: true`).
