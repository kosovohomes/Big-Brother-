# Big Brother — الأخ الكبير v2.1

**Arabic-first legal self-help assistant for the Kuwaiti court system**, rebuilt as a **multi-tenant SaaS** on Next.js 16, in full compliance with **PRD v2.1** (`upload/Big_Brother_PRD_v2.1.md`).

Big Brother helps self-represented litigants and legal-aid NGOs organize case facts, understand procedural deadlines, and draft **educational** court-pack drafts — while staying strictly inside the **UPL boundary** (no unauthorized practice of law, PRD §9.3): every output is educational, every legal citation is resolved against a Local Knowledge Base (LKB), and nothing is released without explicit human acknowledgment.

---

## What v2.1 delivers (PRD v2.1 compliance)

| PRD change | Implementation |
|---|---|
| Two-layer output (§6.3a) | Layer 1 (education) is default; Layer 2 (draft packs) requires a non-dismissible acknowledgment dialog at generation **and** again at export |
| Citation integrity / anti-hallucination | Every citation rendered in the app is resolved via `/api/kb/resolve` against the 48-provision LKB; unresolved citations cannot render. Verified/unverified badges on every provision |
| Phase 0 pending audit | All 48 LKB provisions ship `verified: false` with a bilingual pending-audit note until lawyer review |
| 24h cooling-off (misconduct/Nazaha) | Complaint & Nazoha drafts lock for 24h (`finalizedAt + 24h`), live countdown, lawyer-only release; NGO review-queue orgs keep drafts `IN_REVIEW` until released |
| Decree-Law 80/2026 | Intentionally **absent** everywhere (PRD Change 4) until verified |
| Personal Status Law 51/1996 | 14 new family-law rules + LKB provisions (custody, nafaqa, visitation, khul', documentation path via Personal Status Court) |
| Deadline Radar | Rule-derived procedural deadlines with urgency coloring, court-notice adjustment, and **iCal export** (`/api/cases/[id]/deadlines-ics`) |
| NGO-assisted intake | NGO org type with join codes, caseworker role, review queue, voice-note intake (ASR with consent + graceful fallback) |
| Phase 0 audit workflow | Lawyer-only citation audit queue (`/api/kb/audit`): verify (with mandatory basis note + gazette reference + effective dates), amend (publishes v+1, supersedes old — history never overwritten), deactivate/reactivate; every action written to the audit trail with who/when/why; live Phase 0 progress bar per law |
| Arabic search fix | Tokenizer now strips the definite article **ال** and applies a light stemmer — `تزوير` ↔ `التزوير` now match (BM25-style scoring preserved) |
| Data rights | In-app export (JSON) and scheduled deletion with 7-day completion (§5.10), full audit log |
| Bilingual UI | Arabic-first RTL shell with EN toggle across all 11 panels (incl. Phase 0 audit + billing) |

## Multi-tenant SaaS model

- **Organizations** (`INDIVIDUAL | NGO | LAW_FIRM`) with unique join codes and `FREE | PRO` plan field
- **Users ↔ Memberships** (`OWNER | ADMIN | CASEWORKER | LAWYER | MEMBER`) with active-org session switching (`/api/auth/switch-org`)
- **Tenant isolation**: every business table (cases, documents, drafts, events, deadlines, audit) is scoped by `orgId`; org context is derived server-side from the session on every API call
- NGO orgs can enable the **review queue**: misconduct/Nazaha drafts route to `IN_REVIEW` and can only be released by a lawyer role

## Billing & plans (Stage 5)

- **FREE** (solo): 3 active cases · 5 sealed docs/case · 1 member · 30 analyses/month — **PRO** (9 KWD/mo): 50 cases · 100 docs/case · 25 members · 2,000 analyses/month
- **Ethical gating**: plans limit *capacity & collaboration only* — safety/compliance features (evidence sealing, acknowledgment gates, Phase 0 audit, data export/delete) are never paid features, and downgrading never deletes data
- **Enforced server-side** at 4 choke points (case create, document seal, workspace join, analysis run) with machine-readable `402 plan_limit` responses; the UI shows live usage meters and an upgrade banner
- **Stripe-ready, zero deps**: with `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` set, checkout creates a real Stripe Checkout Session (REST via fetch) and `/api/billing/webhook` applies the subscription lifecycle with HMAC signature verification and event-id idempotency; **without keys it runs in demo mode** (instant PRO activation, fully testable lifecycle)
- **Billing ledger**: every upgrade/downgrade/webhook is recorded in `billing_events` (unique `ref` per Stripe event) and surfaced in the Plan & Usage panel; management actions are OWNER/ADMIN-only

## Notifications & deadline reminders (Stage 6)

- **Per-user inboxes**: every notification is addressed to exactly one user (`org_id + user_id` scoped) — nothing is org-wide, so a member never sees history they were not part of; the header bell carries a live unread badge with 60s polling
- **Deadline Radar reminders (derived, escalating)**: reading the inbox materializes reminders from the same rule-derived deadlines the radar shows — each deadline escalates through `soon (≤30d) → critical (≤7d) → overdue` buckets, and crossing into a more urgent band raises a *new* reminder; a unique `(user_id, dedupe_key)` index makes re-syncs a no-op (no cron needed, idempotent by construction)
- **Workspace events (event-driven)**: review-queue drafts notify every OWNER/ADMIN/LAWYER reviewer on generation (except the submitting actor); the draft creator is notified when a lawyer releases their draft; the case owner is alerted when a sealed document's hash **mismatches** the previous version or carries HIGH metadata risk
- **Bilingual + deep-linked**: every row stores Arabic and English title/body; clicking a case-linked notification marks it read and opens the case timeline; one-click *mark all read*; all styles mirror in RTL/LTR

## Phase A — storage, tenant hardening & evidence originals (implemented)

- **Dual storage backend**: `STORAGE_BACKEND=sqlite` (default, zero-dep dev/test) or `=pg` (Postgres 16) behind one async facade (`src/lib/db.ts` → `src/lib/storage/` drivers); dump-restore migration + rollback via `scripts/pg/migrate-from-sqlite.mjs`
- **Row-Level Security**: policies P1–P15 on every org-scoped table (`scripts/pg/004_rls_policies.sql`), scoped by request GUCs (`app.org_id / app.user_id / app.role`) derived only from the signed session — unset GUCs are fail-closed (zero rows); `legal_provisions` stays a global corpus (C-A9)
- **Per-tenant envelope encryption**: KMS KEK → per-org DEK → AES-256-GCM with AAD tenant binding (`src/lib/crypto.ts`) on `cases.opponent_pleading` and `pack_drafts.payload`; self-describing `enc:v1:` prefix keeps legacy rows readable; rotation (`scripts/rotate-org-key.mjs`) and crypto-shredding on deletion
- **Session revocation (C-A7)**: `users.sessions_invalid_before` kills every cookie issued earlier on logout/revocation; `SESSION_SECRET` mandatory in pg mode
- **Document originals (opt-in)**: `OBJECT_STORAGE_ENABLED=true` seals originals to S3/MinIO with SSE-C under DEK-derived keys + WORM object-lock COMPLIANCE (`retentionUntil`); hash-only mode remains the default; upload idempotency via `Idempotency-Key`; virus-scan hook (ClamAV optional)
- **7-day deletion now completes (C-A2)**: `scripts/reaper.mjs` executes scheduled account/org deletions — revoke sessions → shred DEKs → purge rows → redact PII → tombstone (slug-reuse protected) → append-only audit trail; org offboarding via OWNER-only `POST /api/orgs/:id/delete`
- **Verified e2e**: 98 pre-Phase-A checks unchanged + 34 numbered Phase A checks (T-01..T-22 cross-tenant attack suite, PA-01..PA-12 infrastructure) — `ALL CHECKS PASSED` on SQLite, on Postgres 16 with RLS, and on Postgres + MinIO TLS/SSE-C/WORM (143/143)

`docs/PHASE_A_SPEC.md` is the implementation spec (conflict register C-A1..C-A11, runbook §A1.5, human-only decisions §5).

## Real-law corpus — ingest Kuwaiti statutes into the LKB (implemented)

`corpus/` carries the article-by-article Arabic text of three real Kuwaiti laws — **Penal Code 16/1960 (293), Criminal Procedure 17/1960 (263), Civil & Commercial Procedure 38/1980 (311)** — extracted from public legal-database mirrors and marked `verified_official: false` end-to-end. `SOURCES.json` pins each file's sha256, the mirror-lawId → repo-lawId mapping (`KW-PENAL-16-1960` → `16/1960`, matching the engine's rule refs) and the known data quirks.

```bash
node scripts/ingest-corpus.mjs            # ingest into legal_provisions (idempotent)
node scripts/ingest-corpus.mjs --dry-run  # validate + report, no writes
```

- **Compliance by construction**: every row lands `verified:false` in the Phase 0 lawyer-audit queue with full provenance in `verification_note`; a file claiming `verified_official:true` is REFUSED (verification only ever happens through `/api/kb/audit`, per article); sha256 mismatch against `SOURCES.json` is refused (tamper-evident drops); Decree-Law 80/2026 stays excluded
- **Mirror damage repaired, provenance preserved**: first letters glued into number fields re-attached, مكرر (bis) numbering normalized, whitespace collapsed; the Penal Code's 171 inline amendment labels are parsed into real version chains — v1 original (retained, inactive) + v2 amended text (`معدلة بالمرسوم بقانون رقم 70 لسنة 1979`, `gazette_ref` = mirror publication date, `supersedes_id` wired) mirroring exactly what the lawyer amend action does; repeal markers (`ملغاة`) are surfaced in `verification_note`, never auto-applied
- **Single source of truth kept**: ingested rows live in the same `legal_provisions` table under the repo lawId convention, so `resolveRef`, `/api/kb/resolve`, BM25 search and the engine rules resolve against them; v0.1 fixture coverage (exact numbers and ranges) is never duplicated — overlaps are skipped and reported for Phase 0 reconciliation
- **Report**: every run writes `corpus/INGEST_REPORT.json` (ingested / split-into-versions / repeal-marked / duplicate-variants / fixture-skipped, with details for the lawyer)
- **Verified e2e**: 155 checks — 143 from Phase A (with counts made corpus-size-agnostic) + 12 corpus-integrity checks (idempotency, refusal policies, version-chain integrity, search/resolve reach, unverified flags) — `ALL CHECKS PASSED`

## RAG Phase 1 — retrieval over the law corpus (implemented)

The self-hosted RAG layer from `docs/RAG_SPEC.md` is live: manifest-driven ingestion → article-anchored chunks → hybrid (BM25 + optional local embeddings) retrieval — **proposals only**. `LegalProvision` remains the sole citation source; every hit carries its verification badge and is resolved through `/api/kb/resolve` before any citation display.

```bash
node scripts/rag-build-inbox.mjs                          # corpus/ -> var/rag/inbox/<lawId>/{source.txt,manifest.json}
node scripts/rag-ingest.mjs --scan var/rag/inbox --dry-run # validate + report, no writes
node scripts/rag-ingest.mjs --scan var/rag/inbox          # ingest chunks (idempotent by manifestHash)
# STORAGE_BACKEND=pg + DATABASE_URL_SYSTEM=... work identically (dual-backend)
curl -s localhost:3000/api/rag/status | jq                # coverage, jobs, Phase 0 parity, blocklist
```

- **Endpoints**: `GET /api/rag/search?q=&law=&asOf=&versions=current|historical|all` (any member), `POST /api/rag/ingest` (LAWYER/ADMIN, dryRun supported, source read confined to `RAG_INBOX`), `GET /api/rag/status` — behind the same org gate as every other route; `RAG_ENABLED=false` is the rollback switch
- **Provenance discipline**: the inbox drops are built with `attestation: false` (mirror-class sources) → jobs can never reach INDEXED/LIVE and every hit is flagged `مصدر مرآة مؤقت` until a lawyer pins the real gazette identity in Phase 0; Decree-Law 80/2026 stays hard-blocked (`BLOCKED_POLICY`, e2e RAG-15)
- **Temporal semantics**: chunks carry `effective_from/to` windows — superseded texts stay retrievable only via `versions=historical|all` with their explicit validity window; `asOf` queries answer "what law said X on date Y" (e2e RAG-04..08)
- **Embeddings**: all inference is local (Ollama-compatible, `RAG_OLLAMA_HOST`); with no embed service configured, retrieval degrades gracefully to lexical-only BM25 and `meta.embedMode` says which path served (`pgvector` is the documented Phase R0 upgrade — see `docs/rag/IMPLEMENTATION_STATUS.md` for implemented vs. deferred)
- **Consumer**: the case view's "قوانين ذات صلة" panel renders top hits as proposals with unverified badges and a one-click resolve-through-the-LKB step (`RelatedLaws.tsx`)
- **Verified e2e**: 185 checks on SQLite (185/184 on Postgres+RLS) — includes RAG-01..RAG-10, RAG-13, RAG-15..RAG-18 + tamper/refusal policy checks — `ALL CHECKS PASSED` on both backends

## Architecture

- **Next.js 16 App Router** + TypeScript + Tailwind 4 + shadcn/ui (RTL-ready)
- **Storage**: zero-native-dependency SQLite via `node:sqlite` (`src/lib/sqlite.mjs` + typed facade `src/lib/db.ts`) — the intended Prisma models are documented in `prisma/schema.prisma` for portability
- **Auth**: scrypt password hashing + HMAC-signed cookie sessions (no external deps)
- **Sealing**: SHA-256 document seal with version chain and mismatch flagging
- **Port** 3000; dev log `dev.log`

```
src/
  app/api/…        38 route handlers (auth, orgs, cases, documents, search,
                   kb + resolve + stats + audit queue/actions, drafts lifecycle,
                   deadlines + iCal, voice-note, feedback, audit, data
                   export/delete, billing + checkout + cancel + webhook,
                   notifications + count, health)
  app/page.tsx     single-page shell → src/components/app/AppShell.tsx
  components/app/  RTL shell, org switcher, 11 panels, notification bell,
                   i18n
  lib/             engine (two-layer analysis + Deadline Radar), rules catalog
                   (13 civil/criminal + 14 family), counterReply, packs,
                   arabic tokenizer (ال-strip + stemmer), ical, auth, billing
                   (plans/limits/Stripe), notifications (per-user inbox,
                   escalating reminders, event hooks), db
scripts/seed.mjs   idempotent seed: 48 LKB fixtures, 4 orgs, 5 users, 2 demo cases
corpus/            real Kuwaiti law mirrors (867 articles, sha256-pinned) + SOURCES.json + ingest report
scripts/ingest-corpus.mjs  corpus/ -> legal_provisions (idempotent, refuses unprovenanced or self-claimed-verified drops)
scripts/rag-build-inbox.mjs  corpus/ -> var/rag/inbox drops (deterministic, attestation:false)
scripts/rag-ingest.mjs     manifest-driven RAG chunk ingest (dual-backend, dry-run, 80/2026 blocklist)
scripts/e2e.mjs    API compliance smoke test (185 checks, self-healing) against localhost:3000
upload/            PRD v2.1 (compliance source of truth)
download/          25 verified UI screenshots (auth → panels → cooling-off → audit → billing → notifications → mobile)
```

## Run it

```bash
bun install            # or npm install
node scripts/seed.mjs  # optional — data/big-brother.db ships pre-seeded; idempotent
npm run dev            # http://localhost:3000
node scripts/e2e.mjs   # 155-check compliance smoke test (server must be running)
```

To load the real-law corpus into a fresh database: `node scripts/seed.mjs && node scripts/ingest-corpus.mjs` (both idempotent).

### Demo accounts (password `demo1234`)

| Account | Role | Org type |
|---|---|---|
| `ahmed@demo.kw` | litigant (OWNER) | INDIVIDUAL |
| `ngo@demo.kw` | caseworker (ADMIN) | NGO (review queue ON) |
| `lawyer@demo.kw` | lawyer (LAWYER) | NGO (can release review-queue drafts) |
| `admin@demo.kw` | OWNER | LAW_FIRM |

## Compliance guardrails (in-app, non-removable)

1. UPL boundary notice surfaced in the Compliance panel and on every Layer-2 surface
2. Non-dismissible acknowledgment dialog (checkbox + confirm) before any draft generation; logged again at export
3. 24h cooling-off countdown for misconduct/Nazaha; review-queue orgs add lawyer-only release
4. Unverified-citation badges; LKB resolver blocks unverified references from entering outputs
5. Phase 0 gate: only the LAWYER role can verify/amend/deactivate LKB provisions — verification is recorded with who, when, basis note, and gazette reference
6. Consent capture for voice intake; full audit trail (`/api/audit`)

> **Status**: Phase 0 (lawyer citation audit) is pending by design — all LKB provisions are flagged unverified until a licensed Kuwaiti lawyer completes the review. This software is educational and does not provide legal advice.
