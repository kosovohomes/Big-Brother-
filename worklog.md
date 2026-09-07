# Worklog

---
Task ID: 2
Agent: main (Super Z)
Task: Rebuild Big Brother as PRD v2.1-compliant multi-tenant SaaS on Next.js 16

Work Log:
- Reviewed uploaded PRD v2.1 (13 changes) and built compliance matrix
- Environment: init script partially failed (Prisma schema-engine download blocked by sandbox network policy) → data layer rebuilt on node:sqlite (src/lib/sqlite.mjs + typed facade src/lib/db.ts); schema design documented in prisma/schema.prisma
- Ported + extended libs to TS: arabic.ts (FIX: ال-strip + light stemmer — تزوير↔التزوير now matches), rules/catalog.ts (13 original + 14 new family rules for Law 51/1996, each with structured LKB refs), engine.ts (two-layer analysis, relevance-not-viability, citation resolution vs LKB, Deadline Radar derivation), counterReply.ts, packs.ts (6 PRD §6.6 draft types, misconduct/nazaha = 24h cooling-off + review queue), ical.ts, banners.ts, auth.ts (scrypt + HMAC cookie sessions)
- Seed: 48 LKB provisions (34 imported corpus + 14 family, ALL verified:false pending Phase 0 audit), 4 tenants (individual/NGO w/ review queue/law firm), 5 users, 2 demo cases (civil execution + family NGO-assisted), consents
- 24 API routes: auth (register/login/logout/me/switch-org+join-code), orgs, cases CRUD, events, documents (SHA-256 seal + version chain + mismatch flag), voice-note (ASR via z-ai-web-dev-sdk + consent + fallback), search, kb + stats + resolve (hallucination guard), analysis (Layer 1), drafts (428 ack gate; cooling-off 423; IN_REVIEW lock; release by lawyer only), feedback, deadlines + deadlines-ics, audit, data export/delete, health
- UI: RTL Arabic-first shell, org switcher, 9 panels (dashboard+consent+NGO+voice intake, timeline+radar+iCal, alerts+feedback, grounds+non-dismissible banner+relevance filters, counter educational breakdown, evidence+integrity chain, KB browser+resolver, drafts lifecycle+countdown+preview with cover notice, compliance: UPL boundary+incident process+data controls+audit log)
- Fixed during verify: ByteString Content-Disposition (RFC 5987 filename*), cooling-off clock for review-queue drafts (finalizedAt at generation), DraftsPanel generate() stale-ref bug
- E2E: scripts/e2e.mjs → 39/39 checks passed (428/409/423/403 gates, search fix, resolver, iCal, audit, cooling-off survives review release)
- Browser E2E (agent-browser): auth→dashboard→timeline/radar→alerts→grounds→ack dialog(disabled→checkbox→confirm)→generate→finalize→export→EXPORTED, misconduct countdown 23:59:59, KB search تزوير hits with unverified badges, compliance panel, mobile 390px + sticky footer — all verified, 13 screenshots in download/

Stage Summary:
- App: Next.js 16 + TS + Tailwind 4 + shadcn/ui, node:sqlite storage, port 3000, lint 0 errors
- Demo accounts (password demo1234): ahmed@demo.kw (litigant), ngo@demo.kw (caseworker), lawyer@demo.kw, admin@demo.kw
- Compliance stance: every citation carries verified/unverified badge; "Decree-Law 80/2026" intentionally absent (PRD Change 4); Layer 1 default / Layer 2 explicit with logged acknowledgments at generation AND export; 24h cooling-off + review queue for misconduct/Nazaha; NGO-assisted + voice-note intake first-class; UPL boundary surfaced in-app

---
Task ID: 3
Agent: main (Super Z)
Task: Publish v2.1 build to GitHub (user-provided PAT), stage-by-stage going forward

Work Log:
- Verified PAT (owner: almizanpro-del) and write access to almizanpro-del/Big-Brother-
- Security scan: no secrets in tracked files; untracked .env (placeholder only), .zscripts/dev.pid, data/*.db-wal|-shm, internal tool-results/, and the Big-Brother- reference clone gitlink; extended .gitignore
- Wrote repo README.md (PRD v2.1 compliance matrix, SaaS model, architecture, run steps, demo accounts) + .env.example
- Set git identity to almizanpro-del; squashed workspace into one clean orphan commit ff96b0e (157 files, no junk)
- Pushed original v0.1.0 history to branch archive/v0.1.0 (non-destructive), then force-pushed new main
- Re-ran scripts/e2e.mjs against live server: ALL 39 CHECKS PASSED

Stage Summary:
- github.com/almizanpro-del/Big-Brother- main = ff96b0e (v2.1 multi-tenant SaaS), archive/v0.1.0 = original MVP
- Convention adopted: every completed stage is committed and pushed to main immediately

---
Task ID: 4
Agent: main (Super Z)
Task: Stage 4 — Lawyer-side Phase 0 citation audit workflow (PRD 3.3 / 6.3a)

Work Log:
- Schema: added verified_by/verified_at to legal_provisions (DDL + idempotent PRAGMA migration for existing DBs); Prisma model updated for parity
- db.ts: getProvisionById, getAuditStats (active-only counting, per-law chips), verifyProvision (note + gazetteRef + effectiveFrom/To + who/when), amendProvision (v+1 supersedes old, history retained, unique(law,article,version)), deactivate/reactivate
- API: GET /api/kb/audit (queue + stats + phase0Complete + canVerify; ?includeArchived=1 for history), POST /api/kb/audit/[id] (LAWYER-only: verify|amend|deactivate|reactivate; 400 on missing note; audit() trail entries kb.audit.*)
- UI: 10th panel "Citation Audit (Phase 0)" — progress bar + per-law chips + Phase-0-complete banner, law/status/search filters, archived toggle, expandable lawyer action form (verify/amend/deactivate, reactivate on archived rows); read-only notice for non-lawyers; i18n keys added (bilingual)
- e2e: new section [9] (17 checks: transparency read, 403 for non-lawyer, 400 noteless verify, verify with basis+gazette, who/when recorded, count adjustments, amend supersedes + resolver returns v+1, deactivate→47/reactivate→48, kb.audit trail) + made suite self-healing (creates case+judgment event when a prior run's wipe removed the demo case; picks event-driven case; flag-presence citation check)
- Fixed during verify: getAuditStats counted archived verified rows in per-law chips; e2e lawyer org switch (LAW_FIRM default role OWNER ≠ LAWYER → 403s); health expectation 47 after deactivate
- Browser E2E (agent-browser): lawyer login → switch to NGO org → audit tab → LAWYER badge + review queue chip → review form → verify with note + gazette → toast, progress 0→1/47, badge flips to verified; screenshots 14-audit-panel.png + 15-audit-mobile.png
- Full suite: ALL CHECKS PASSED (59 ✔), eslint 0 errors

Stage Summary:
- Phase 0 is now operable: a licensed lawyer can sign off each LKB provision with recorded basis + gazette ref; amendments preserve full version history; every action auditable
- Next stage candidates: Stripe/billing (FREE→PRO), Postgres migration, notifications

---
Task ID: 5
Agent: main (Super Z)
Task: Stage 5 — Billing & plans: FREE→PRO lifecycle, capacity limits, Stripe-ready payments

Work Log:
- Schema: organizations gained plan_status/plan_renews_at/stripe_customer_id/stripe_subscription_id (DDL + idempotent migration); new billing_events ledger with unique(ref) partial index for webhook idempotency; Prisma parity (BillingEvent model)
- src/lib/billing.ts: FREE (3 cases / 5 docs / 1 member / 30 analyses-mo) vs PRO 9 KWD (50/100/25/2000); zero-dependency Stripe REST checkout via fetch; HMAC-SHA256 Stripe-Signature verification with 5-min tolerance
- API: GET /api/billing (plan + usage vs limits + ledger, member-readable), POST /api/billing/checkout (OWNER/ADMIN; Stripe redirect when keys set, demo instant PRO otherwise), POST /api/billing/cancel, POST /api/billing/webhook (checkout.session.completed / subscription.updated / deleted, event-id idempotent)
- Enforcement (402 plan_limit, machine-readable) at 4 choke points: POST /api/cases, document seal, switch-org join (seats), GET analysis (monthly fair-use, metered via audit 'analysis.run')
- UI: 11th panel "الباقة والاستخدام / Plan & Usage" — plan card + status + renews, 4 usage meters, FREE/PRO comparison, ledger, demo-mode note, OWNER/ADMIN-only actions; header plan badge (live refresh via onPlanChanged→loadMe); 402 upgrade banner replaces analysis panels when capped
- Ethics stance encoded in UI copy + README: capacity-only gating — safety/compliance (evidence sealing, ack gates, Phase 0 audit, data export/delete) never paid; downgrade retains all data
- e2e: new section [10] with 20 checks (402 cap, upgrade lifts cap, PRO seat join, member 403 + read-only view, cancel re-applies limits with data retained, analysis metering, webhook 503 unconfigured, ledger contents + newest-first) → 79/79 passing
- Browser E2E (agent-browser): FREE badge → billing tab → upgrade → PRO badge + ledger entry + toast; cancel → live badge flip back to FREE; screenshots 16–19 in download/
- Fixed during verify: POST /api/orgs double-mapped getOrgById output, silently dropping joinCode/createdAt since v2.1 (exposed by the new seat-limit test) — removed wrapper + guard comment; stale Turbopack compile investigated first (red herring), .next nuke harmless
- Docs: README "Billing & plans (Stage 5)" section + updated architecture tree (35 handlers, 11 panels, 79 checks); .env.example Stripe vars (STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET)

Stage Summary:
- Full SaaS billing lifecycle operable without any external dependency (demo mode) and swap-ready for real Stripe by adding 3 env vars
- origin/main = 4b5114a "feat(stage-5): billing & plans"; e2e 79/79, lint 0 errors
- Next stage candidates: Postgres migration (production scaling), notifications (deadline reminder center), NGO/law-firm seat management UI

---
Task ID: 6
Agent: main (Super Z)
Task: Stage 6 — Notification center: deadline reminders, review/integrity events, header bell

Work Log:
- Schema: new notifications table (per-user inbox, org_id+user_id scoped, NOTHING org-wide) with unique(user_id, dedupe_key) idempotency index; mapNotification mapper + db.ts re-export; Prisma Notification model for parity
- src/lib/notifications.ts: notifyUser (idempotent insert), syncDeadlineReminders (materialize-on-read: derives the same rule-based deadlines as the radar for every org case and files reminders in escalating buckets soon ≤30d → critical ≤7d → overdue; crossing a band raises a NEW row, re-syncs are no-ops via dedupe key), event hooks — notifyReviewersOfDraft (IN_REVIEW → all OWNER/ADMIN/LAWYER except actor), notifyDraftReleased (creator, skip self-release), notifyDocumentIntegrity (hash mismatch → owner; HIGH meta risk → owner unless self-sealed)
- API: GET /api/notifications (sync + inbox + unread + newlyDerived), POST /api/notifications (mark one/all, recipient-scoped), GET /api/notifications/count (badge poll with sync)
- Hook wiring: draft creation route (review-queue drafts land IN_REVIEW at creation — discovered the finalize-route hook alone was unreachable for them; finalize hook kept as legacy fallback), release route, documents route
- Fixed latent bug found on the way: GET /api/cases/:id/documents crashed with ReferenceError (getDocumentsForCase used but never imported since v2.1 — UI reads docs from the case-detail bundle so it never surfaced); import added, verified live 200
- UI: NotificationBell — header popover inbox with unread badge (99+ cap), bilingual rows (stored ar/en), urgency badges, relative time, deep-link click = mark-read + open case timeline, mark-all-read, 60s polling; i18n keys added
- e2e: new section [11] (18 checks: derivation, dedupe idempotency, escalation on fresh deadline, recipient-scoped mark-one, mark-all, badge count, reviewer fan-out w/o self-notify, lawyer receives request, release → creator notified, doc seal + hash mismatch → owner alert, non-reviewer leak-freedom, row scoping) + made the doc pair FREE-cap-aware (skips on cap-exhausted reused DBs, row-persistence check covers) + fixed section [7] case-selection fragility (family case now found by caseType, not cases[0])
- Browser E2E: lawyer → NGO org → badge 5 → panel (urgency badges, unread dots, bilingual) → deep-link click opens family case timeline + badge 5→4 → mark-all clears badge; EN/LTR + 390px mobile verified; screenshots 20–25 in download/
- Full suite: ALL CHECKS PASSED (97–98), eslint 0 errors
- Docs: README "Notifications & deadline reminders (Stage 6)" section, architecture tree (38 handlers, bell, notifications lib), e2e count 98

Stage Summary:
- The Deadline Radar now reaches users: escalating per-user reminders (soon → critical → overdue) with zero cron — inbox reads materialize and dedupe
- Workspace events close the loop: review requests reach lawyers, releases reach creators, evidence-integrity mismatches reach case owners — each strictly per-user
- Next stage candidates: Postgres migration (blocked in-sandbox; schema parity kept in prisma/schema.prisma), email/push delivery for reminders, NGO/law-firm seat management UI

---
Task ID: 7
Agent: main (Super Z)
Task: Technical Architecture Specification — clone-read the repo per the architect brief, verify claims vs code reality, produce the 8-section spec as a formal PDF (deliverable), commit to repo and push to main

Work Log:
- Read every file named in the brief: README.md, upload/Big_Brother_PRD_v2.1.md (key clauses 5.6/6.3/6.3a/9.2/9.3/11/App E), prisma/schema.prisma, engine.ts, rules/catalog.ts, counterReply.ts, packs.ts, db.ts, sqlite.mjs, notifications.ts, billing.ts, arabic.ts, api-helpers.ts, types.ts, /api/kb/** (list/resolve/stats/audit), /api/search, /api/cases (+analysis), scripts/e2e.mjs
- Verified claims vs code: e2e = exactly 98 check() calls, executed live → ALL CHECKS PASSED; regex counter-reply confirmed; all 10 asserted gaps confirmed with file-level evidence
- Conflict register (flagged, not assumed): C1 PRD 6.3a amend→re-evaluate/notify missing (amendProvision supersedes but no impact scan); C2 PRD 5.6 AC3 per-point evidence hash only partially implemented; C3 95%-verified KPI is 0% by design pending Phase 0; C4 PRD self-hosting judgment call vs stricter brief mandate; C5 admission category intentionally absent; C6 hardcoded WINDOWS pending lawyer validation
- Authored the spec (9 sections incl. decision register): verified inventory (14 capabilities × files), 10 confirmed gaps, 6 conflicts; target architecture (Postgres path via StorageAdapter + prisma parity, engine purity preserved, RAG ingestion/article-chunking, bge-m3 vs mE5-large + pgvector vs Qdrant tradeoffs, hybrid retrieval with asOf temporal filter closing the isActive-only gap, self-hosted Qwen2.5 Layer-2 with per-sentence traces, MinIO WORM, pg-boss forensics worker); tenant hardening (Vault Transit envelope encryption + crypto-shredding reconciled with 7-day deletion and a non-shredded audit key, RLS via SET LOCAL app.org_id, 22 numbered cross-tenant checks T-01..T-22, onboarding/offboarding runbook, white-label org fields); rule catalogue DDL + zod loader + golden-file parity (98 checks unchanged); Counter-Reply v2 (5-stage pipeline, opponent-citation extraction validated via resolveRef, counter_responses + response_traces schema per PRD 5.6 AC3, predicate-driven viability downgrade + needs_human_review, amendment re-evaluation closing C1); safety gates (minors/DV/coercion intake screening with specialist routing, export-blocking 423 lawyer_review_required preserving all existing gates, embedded OUTPUT_POLICY); OpenAPI sketches (documents/upload multipart+Idempotency-Key, rag/search, rag/ingest lawyer-admin, counter-reply/v2, tenant/keys/rotate; 402 plan_limit convention preserved); Phase A/B/C plan with rollback; e2e extension 98→162 (T-01..22, PA-12, PB-16, PC-14); 9 human-only decisions
- PDF production (pdf skill Report route): Template 07 Crystal Blue cover (poster_validate + cover_validate pass → html2poster.js @794px); body via ReportLab TocDocTemplate/multiBuild (26pp, roman TOC + arabic body numbering, CondPageBreak orphan control, safe_keep_together, palette-locked tables, 6 mono code blocks); architecture figure via Playwright+CSS → PNG @2× (labels [T]/[P] sensitivity) + ASCII text-form diagram in DejaVuSansMono
- QA chain all green: meta.brand, pages.clean (0 blank), font.check (0 issues), toc.check (pass), pdf_qa --skip-cover PASS 13/13 (fixed: cover A4 normalization tolerance, em-dash line-start NBSP guard, code-block label binding, code.sanitize entity-mangling worked around via chr()-built escapes)
- Fixed along the way: content module syntax (table vs num block closers), ARCH_TEXT definition order, Arabic strings replaced with transliterations (ReportLab cannot shape Arabic script)

Stage Summary:
- Deliverable: download/Big-Brother-Technical-Architecture-Specification.pdf (26 pages, 516 KB, vector, clickable TOC) + cover/diagram sources in download/tas-source/; committed to repo at docs/
- Spec is grounded end-to-end in the verified v2.1 codebase; every proposal cites the file/module it extends; all 98 existing e2e checks remain the unchanged compatibility baseline (162 target after Phases A-C)
- Next stage candidates: begin Phase A (Postgres + RLS + envelope crypto + MinIO + T-suite), or the Phase 0 lawyer-audit working session (decision register items 3/8)

---
Task ID: 8
Agent: main (Super Z)
Task: Phase A implementation plan + migration spec (SQLite→Postgres, tenant hardening, document originals) — doc only, no code

Work Log:
- Read every file named in the brief: README.md, prisma/schema.prisma, sqlite.mjs, db.ts, auth.ts, engine.ts (read-only), scripts/e2e.mjs, data/delete route, documents route; plus billing.ts, notifications.ts, billing webhook route, api-helpers.ts, types.ts, voice-note route (grep), PRD 5.10/§7 clauses
- Verified brief-vs-code: e2e = exactly 98 check() calls (correct); notifications.ts/billing.ts exist; src/app/api/documents/route.ts DOES NOT EXIST (documents live at /api/cases/[id]/documents) — flagged C-A1
- Authored docs/PHASE_A_SPEC.md (590 lines): verified baseline B1-B11; conflict register C-A1..C-A11 (7-day deletion scheduled-only with NO reaper; nullable audit org + PII-ish details vs hash-only audit; getCaseById no org filter; rowid ORDER BY; @@map missing; stateless sessions unrevocable; webhook = cross-tenant system actor; legal_provisions global; in-memory upload)
- A1: thin pg layer behind the db.ts facade (StorageDriver + AsyncLocalStorage tenant-tx in requireOrg — no second org path); dialect inventory; dump-restore + flag cutover chosen over dual-write (decision matrix); 7-day deletion behavior mid-migration specified; Prisma diffs before/after per model (OrgEncryptionKey new; Document storageKey/storageVersionId/storageClass/retentionUntil/deletedAt/virusScan*; seq on billing_events+notifications)
- A2: RLS DDL P1-P15 on every table (direct org equality / EXISTS-through-parent / user-scoped / global corpus exclusion; fail-closed current_setting GUCs); GUC middleware extending requireOrg; envelope encryption (KMS→per-org DEK→AES-256-GCM, AAD tenant binding, enc:v1 prefix = backward compatible); crypto-shredding reconciled with 7-day workflow + survivor table (what survives & why legally sufficient); T-01..T-22 cross-tenant e2e suite (forged cookies, IDOR sweeps, cross-org webhook replay, session replay post-logout)
- A3: object originals opt-in via OBJECT_STORAGE_ENABLED (hash-only default preserved); upload flow stream→ClamAV→SSE-C with org DEK→WORM COMPLIANCE lock→same seal/chain/notify calls; WORM vs deletion right reconciled via DEK shred; API contract for upload/download/presign
- A4: phases A0-A5 each shippable+rollback; RLS script outline; e2e additions T-01..22 + PA-01..12 = +34 → 132 total (98 unchanged); env/config matrix (flag defaults reproduce today's behavior in sandbox); constraints checklist; 8 human-only decisions
- Copied deliverable to download/Phase-A-Implementation-Spec.md

Stage Summary:
- Phase A spec grounded file-by-file in the verified codebase; every proposal cites the module it extends/replaces; engine.ts untouched by design
- Key flagged findings: C-A2 (deletion never completes — compliance gap Phase A closes), C-A3 (audit PII vs shredding), C-A7 (session replay possible post-logout — fix scheduled)
- Next: human sign-off on §5 decisions, then implement Phase A0+A1 (docker-compose + driver interface), or resume Stage 4 Phase 0 lawyer-audit working session

---
Task ID: 9
Agent: main (Super Z)
Task: Self-hosted RAG architecture for Kuwaiti laws — design spec only (corpus/sources, ingestion, embeddings/vector store, retrieval API, grounded LLM, evaluation, deliverables); RAG must feed LegalProvision + resolveRef, never parallel to them

Work Log:
- Read mandated files: prisma/schema.prisma (LegalProvision L111-146), engine.ts (resolveRef/resolveAll L36-64, read-only), arabic.ts (normalizeAr/stemAr/BM25), /api/kb/** (list/resolve/stats/audit), /api/search/route.ts, seed-data/corpus.json (+family.json), scripts/e2e.mjs; verified 80/2026 exclusion at README.md:17
- Verified claims vs code: e2e = exactly 98 check() calls (stale "39" note corrected, C-R1); corpus = 34+14 = 48 provisions seeded verified:false with effectiveFrom NULL (seed.mjs L37); LegalProvision ALREADY carries amendmentVersion/effectiveFrom/effectiveTo/gazetteRef/version/supersedesId/isActive + @@unique([lawId,articleNo,version]) — RAG needs zero changes to existing models
- Authored docs/RAG_SPEC.md: §1 corpus hierarchy (Al-Kuwait Al-Yawm canonical w/ issue+date+page per chunk; moj/e.gov cross-check only; NA = context docs never provisions) + permissioned drop-dir/manifest CLI + initial scope mapped to existing lawIds (Evidence Law = new EVID/<year> placeholder; 80/2026 blocklist preserved); §2 ingestion state machine, PaddleOCR vs Tesseract-ara tradeoffs + 0.85 confidence gate, canonical/normalized dual text with arabic.ts parity port + conformance vectors, article-anchored chunking, amendment-pattern detector (REPLACE/INSERT/REPEAL/RENUMBER/RESTATE/GENERAL_REPEAL) emitting ProvisionAmendment records applied ONLY via the existing kb/audit version-chain mechanism (v+1 row + supersedesId, old row closed, never overwritten), verified:false default routed into the existing Phase 0 audit queue; §3 bge-m3 (pick, MIT, 1024d, 8192ctx, MIRACL-ar ~0.70) vs mE5-large + pgvector (pick — transactional with LegalProvision, temporal filters as SQL, aligns with Phase A A1) vs Qdrant (scale-out path), MIRACL-ar/Mr.TyDi/ArabicMTEB + gold-set benchmark protocol, 24GB-GPU/CPU hardware targets, internal-network no-egress enforcement; §4 hybrid BM25+vector RRF retrieval with mandatory temporal filter (effective_from<=q AND (effective_to IS NULL OR effective_to>q) AND isActive; NULL dates = current-pending-Phase-0 so the 48 stay retrievable) + versions=current|historical|all flag for superseded-only retrieval; additive Prisma diff (RagChunk, ProvisionAmendment, IngestJob, RagQueryLog — LegalProvision untouched); response contract superset of /api/search; consumption ALWAYS through existing resolveRef//api/kb/resolve; endpoints /api/rag/search|ingest|status with kb/audit-parity role gate; §5 Qwen2.5-14B-AWQ on vLLM (Ollama CPU fallback, ALLaM license-pending), Layer-2 draft-only with verbatim provision injection + per-sentence trace {provisionId, extractedText, evidenceHash} or unverified flag mirroring resolveAll, output passes ALL existing Layer-2 gates unchanged (ack 428, cooling-off 423, review queue), EXTERNAL_LLM_ENABLED default OFF + anonymizer allowlist; §6 100-question gold set, citation accuracy >=95%, zero superseded leaks, P95 <2s, scripts/rag-eval.mjs harness
- Authored docs/rag/DELIVERABLES.md (compose stack table + env matrix, normative state machine, 13-step operator runbook, e2e additions RAG-01..RAG-18: ingest authz 3, superseded-retrieval 6, grounding-trace 5, corpus-policy/integrity 4 — baseline 98 + 18 = 116); docs/rag/schemas/manifest.schema.json + chunk.schema.json (JSON Schema draft-07); docs/rag/docker-compose.rag.yml (pgvector/pg16, MinIO, TEI bge-m3, ollama/vllm profiles, ocr-worker, qdrant alt, internal no-egress network)
- Conflict register C-R1..C-R10 flagged (stale e2e count corrected; dual seed-JSON shapes; Law 9/2020 = repo's Electronic Service Law naming preserved; Evidence Law absent from corpus -> manifest-pinned; /api/search in-memory BM25 must not scale -> persisted indexes; kb/stats raw SQLite SQL -> driver note; version-chain already exists -> purely additive work; resolveRef substring range matching -> exact provisionId from RAG + re-resolve; kb/audit amend mechanism reused; NULL effectiveFrom semantics defined so Phase A/RAG cannot silently empty search)

Stage Summary:
- Deliverables: docs/RAG_SPEC.md, docs/rag/{DELIVERABLES.md, docker-compose.rag.yml, schemas/manifest.schema.json, schemas/chunk.schema.json} — design only, no code, engine.ts untouched
- Core invariants kept: LegalProvision = single citation source of truth; verified:false defaults; append-only supersedesId history; no case data leaves the deployment; 80/2026 stays excluded
- Next candidates: sign-off on picks (bge-m3+pgvector, Qwen2.5-14B-AWQ) then implement Phase R0 (compose + schemas + ingest CLI skeleton), or resume Phase A implementation (Task 8 spec) — RAG db/minio targets depend on it

---
Task ID: 10
Agent: main (Super Z)
Task: Phase A implementation (Task 8 spec) — A0..A5 in code: Postgres16+RLS dual storage backend, envelope encryption, document originals with WORM, deletion reaper, session revocation, cross-tenant e2e suite

Work Log:
- Read docs/PHASE_A_SPEC.md end-to-end + every file it extends (db.ts, sqlite.mjs, auth.ts, api-helpers.ts, all 35 route files, billing/notifications libs) before touching code; verified environment (no root/docker — adopted embedded-postgres binaries + MinIO single binary for REAL infrastructure verification)
- A1 storage: src/lib/storage/{driver.ts, sqlite-driver.mjs, pg-driver.mjs, index.ts} — StorageDriver interface, ?→$n rewriter, dual pools (bb_app NOBYPASSRLS / bb_system bypass), AsyncLocalStorage request scope made bundle-safe via globalThis singletons (Turbopack instantiates lib modules per route bundle — module-level ALS silently broke GUC scoping, root-caused via current_user probe)
- Async facade: db.ts + api-helpers.ts rewritten async; withOrg() route wrapper establishes a shared mutable ALS store that requireOrg binds the RLS tenant client into (requireOrg cannot wrap handler bodies — resolved the spec's sketch to an executable pattern); all ~35 handlers awaited + wrapped (codemod + manual fixes); raw db.prepare call sites converted (kb/stats → facade getKbStatsByLaw etc.); auth routes (login/register/switch-org/me/logout) system/user-scoped per A2.1 role model
- A2 hardening: RLS DDL P1–P15 (scripts/pg/001..006+901 — roles, tables mirroring sqlite.mjs + Phase A additions, indexes, SECURITY DEFINER app_execute_delete/app_notify, least-privilege grants + bb_system DML fixes: BYPASSRLS bypasses POLICIES not PRIVILEGES, identity sequences need grants); session revocation users.sessions_invalid_before (C-A7, e2e T-21 proves replay dies at logout); COOKIE_SECURE env; SESSION_SECRET boot guard in pg mode; audit() always system-scoped (P12 WITH CHECK cannot fail on non-tenant paths); webhook idempotency gate BEFORE plan mutation (T-20 replay = true no-op)
- A3 crypto: src/lib/crypto.ts envelope encryption (dev KMS master-key file → per-org DEK wrapped AES-256-GCM → field-level GCM with AAD org|table|column|rowId; enc:v1 self-describing prefix = legacy passthrough PA-07); wired on cases.opponent_pleading + pack_drafts.payload write+read (getCaseForOrg/getDraftForOrg transparent decrypt); scripts/rotate-org-key.mjs (PA-08: rotation → old rows decrypt, new writes carry new keyVersion)
- A4 object originals: src/lib/storage/object-store.ts zero-dep SigV4 (SSE-C under DEK-derived per-object keys, WORM COMPLIANCE retain-until); documents POST = stream→ClamAV hook→sha256→PUT SSE-C+lock→seal contract unchanged; download route (proxied — presign cannot carry SSE-C keys without leaking them, contract returns 501); presign endpoint OWNER/ADMIN; voice-note parity; upload idempotency (Idempotency-Key partial unique index)
- A5 reaper: scripts/reaper.mjs (pg advisory lock / sqlite pid-file; per-org last-member semantics; shred DEKs → purge → redact → tombstone → audit) + OWNER-only POST /api/orgs/:id/delete with double confirm (428 without {confirm:'DELETE'}); closes compliance gap C-A2 (PA-11/PA-12 prove execution + grace)
- A0 artifacts: docker-compose.yml (pg16+pgvector, MinIO, app), .env.example full matrix (defaults = today's behavior), schema.prisma @@map/@map parity + OrgEncryptionKey/Document storage fields/seq columns/Organization offboarding; PA-01 runner scripts/run-e2e-both.mjs
- e2e: sections [12]+[13] added as scripts/e2e-pa-sections.mjs (imported by scripts/e2e.mjs, cookie-jar refactor) — T-01..T-22 cross-tenant attacks (forged-cookie 401, IDOR sweep 404s incl. lifecycle/status leak, notification isolation, join-code oracle uniformity, forged orgId ignored, audit/billing isolation, SIGNED webhook replay no-op, session replay post-logout, presign/download tenancy) + PA-01..PA-12 (dual-backend runner, fail-closed probe, ciphertext-at-rest via direct sqlite reads, legacy passthrough, rotation, seal+download+WORM, reaper execution+grace)
- Verification (live, not simulated): embedded Postgres 18 cluster via scripts/pg/setup-embedded.mjs → 001..006 applied → dump-restore verified row-by-row (16 tables, documents.hash spot-checks) → server on STORAGE_BACKEND=pg: iterations fixed Turbopack stale cache, missing awaits (kb/search), getDriver import path, grants for bb_system + sequences, health P13 system scope, audit P12, provision writes system scope, switch-org unscoped reads, TLS for SSE-C (MinIO refuses SSE-C over HTTP — self-signed cert + NODE_EXTRA_CA_CERTS), ensureBucket lock-enabled header, WORM probe rewritten on official AWS SDK (devDep, probe-only): marker DELETE 204 → version survives → version-level DELETE REFUSED 'Object is WORM protected' = COMPLIANCE proven
- Final results: SQLite default 142/142; Postgres+RLS 141/141 (one sqlite-only raw-read sub-check); Postgres+MinIO+webhook secret 143/143 ALL CHECKS PASSED (98 baseline unchanged + 34 numbered Phase A + 11 fixture/support assertions); dev server restored to default sqlite mode (health: node:sqlite corpus 48)
- Fixed in passing: e2e.mjs corrupted by a careless inline command — restored from git and redone carefully; large-file push rejection (MinIO binary committed) cleaned; secrets (dev TLS key) + MinIO internals removed from commit via amend + force-with-lease; cert regenerated untracked

Stage Summary:
- Phase A fully implemented + verified on REAL infrastructure: flag defaults preserve today's behavior; engine.ts untouched; all guardrails (ack 428, cooling-off 423, review queue, verified:false, 402 plan_limit, hash-chain) re-proven green
- Deliverables on main: storage drivers + async facade, RLS SQL suite, crypto module, object-store, reaper, migration + setup + runner scripts, compose/.env.example, schema.prisma parity, README Phase A section
- Deferred/flagged: PA-01 dual-backend CI runner requires a Postgres service in CI (works locally); presign contract 501 while SSE-C mode on (documented deviation — server-held keys); audit-detail redaction wording remains human decision §5.2; DOC_RETENTION_YEARS=5 default pending legal sign-off §5.1

---
Task ID: 11
Agent: main (Super Z)
Task: Ingest the uploaded real Kuwaiti law corpus (Penal Code 16/1960, Criminal Procedure 17/1960, Civil Procedure 38/1980 — 867 mirror articles) into the LKB; inspect + integrate per RAG/Phase-A architecture; "inspect and do whatever is needed"

Work Log:
- Inspected upload (files(1).zip): README_legal_corpus.md + 3 cleaned article-JSON laws (867 articles), all verified_official:false with explicit UNVERIFIED status; the 4th found file (kuwait_laws_articles.jsonl) was already discarded at the source as broken scraping debris — never ingested
- Data-quality scan before writing any code: 171 Penal articles carry inline amendment labels (النص النهائي/النص الأصلي with amending-law ref + publication date); 7 مكرر variants in Penal, 6 messy ones in CrimProc ('104مكررا', '216مكرر 1'); CrimProc has 7 article numbers appearing twice (pre/post-amendment variants, some OCR debris); CivProc has 96 rows with the first text letter glued into article_number_raw ('4 \nا' + 'ذ نص...' = 'اذا نص...') and art 177 = 'ملغاة'; CivProc section_heading always empty
- Committed corpus/ : 3 law JSONs (verbatim) + SOURCES.json (sha256 pinning, mirror→repo lawId mapping KW-PENAL-16-1960→16/1960 etc., known quirks, exclusions, operator attestation) + adapted README documenting the pipeline; deliberate deviation: SOURCES.json is an article-mirror source class, NOT the gazette-drop manifest.schema.json (that stays for future Al-Youm PDF drops with known issue numbers)
- scripts/ingest-corpus.mjs (dual-backend sqlite/pg like reaper): validate-before-write (header fields, article_count, sha256 vs SOURCES.json, verified_official must be false → REFUSAL otherwise), glue repair, مكرر normalization, first-occurrence dedupe, fixture-coverage skip (existing exact numbers AND ranges like 35-44 expand to covered set), Penal amendment split into version chains (v1 original inactive → v2 'معدلة بالمرسوم بقانون رقم N لسنة Y' active, supersedes_id wired, mirror pub date in gazette_ref — mirrors kb/audit amend semantics), repeal markers (ملغاة) surfaced in verification_note but never auto-applied (repeal vs amending-law-repealed ambiguity is a human call), everything verified:false + lkb.ingest audit row, idempotent via unique(law_id, article_no, version); --reset-ingested flag (guarded: only unverified lawyer-untouched ingest-provenance rows) for parser-fix cycles
- Fixed 3 self-found bugs: (1) stale fresh-filter overwrote skippedExisting attribution → counters now owned by the classification loop; (2) glue regex [\s\n]* consumed the newline before the glue group → 96 CivProc texts lost their first letter, art 177 wrongly dropped; (3) split v1 kept 'للمادة:' label tail; also amended the split label to the grammatical 'معدلة بالمرسوم بقانون رقم 70 لسنة 1979'
- Ingested for real: 946 rows (16/1960: 401 incl. 126 version-chain splits; 17/1960: 249; 38/1980: 296 incl. art 177 recovery); corpus now 1020 rows / 868 active; lkb.ingest audit row written; INGEST_REPORT.json committed
- Fixed latent Phase A bug found during planning: reaper.mjs pg path passed raw `?` placeholders to node-postgres (needs $n) — PA-11's pg assertion masked it (passed on login-403 alone); added the same quote-aware ?→$n rewriter used by the pg driver
- e2e made corpus-size agnostic (intent preserved): [1] corpus >= 48 captures a baseline; [9] stats/deactivate/reactivate now relative to baseline; PA-02 >= 48; new section [14] (12 checks): idempotent re-ingest no-op, kb stats cover the 3 laws, search retrieves real Penal art 1 with unverified flags, resolver resolves ingested articles + returns amended v2 of split art 3, v1 retained inactive + supersedesId + mirror gazetteRef, ingested rows unverified in the Phase 0 queue, REFUSAL of verified_official:true files and of sha256 mismatches (corpus unchanged after both)
- AuditPanel: render cap (80 cards + 'يُعرض 80 من 868' note) — the 900-row queue stays DOM-fast; no data changes
- Verification: 155/155 ALL CHECKS PASSED (143 Phase A + 12 new; PA-02 renamed); search latency measured 80–130ms at 868 docs (in-memory BM25 fine at this scale — persisted indexes stay a Phase R0 item); browser-verified audit panel at scale (per-law chips 16/1960: 1/281, 17/1960: 0/256, 38/1980: 0/311, cap note, unverified badges) + KB search 'تزوير' hits with badges; screenshots 17-audit-scale.png, 18-search-real-laws.png
- Note: side effect of the suite being self-healing — section [9] verified+amended ingested art 1 in the dev DB (v2 'amendment-v2' active unverified, v1 verified inactive) — demonstrates the audit flow operating on ingested real-law rows

Stage Summary:
- The Legal Knowledge Base now carries the full real text of the three most-litigated Kuwaiti statutes (867 articles) under the exact PRD 6.3a discipline: unverified badges everywhere, lawyer-only verification, version chains, tamper-evident provenance
- Deliverables: corpus/ (3 laws + SOURCES.json + README + INGEST_REPORT.json), scripts/ingest-corpus.mjs (validate/repair/split/idempotent, dual-backend, refusal policies), reaper pg fix, corpus-size-agnostic e2e + section [14], AuditPanel scale cap, README corpus section
- engine.ts untouched; resolveRef semantics unchanged; all guardrails re-proven green
- Next candidates: RAG Phase R0 (compose + RagChunk schema + embedding pipeline — now has a real 867-article corpus to chunk/embed), lawyer Phase 0 working session on the 867-row queue (or per-law), Law 9/2020 full-text sourcing

---
Task ID: 12
Agent: main (Super Z)
Task: RAG Phase 1 per the uploaded harness prompt ("Integrate Kuwait Ministry of Justice laws into Big Brother's RAG pipeline") — review + build: ingestion pipeline, real-corpus ingest, retrieval API, minimal UI consumer, verification gates

Work Log:
- Reviewed the uploaded harness prompt + docs/RAG_SPEC.md, DELIVERABLES, both schemas in full before coding. Flagged harness↔repo drift: (1) harness example `manifestVersion "1.0"` vs schema `const "1"` — followed the schema; (2) schema `attestation const true` would force rubber-stamping mirror-class sources — extended the schema to a boolean: false = provisional source ⇒ job can never reach INDEXED/LIVE + every hit flagged `provisionalSource` (documented in docs/rag/IMPLEMENTATION_STATUS.md §deviations); (3) no `rag-phase1.patch`/zip exists in the upload (only the already-ingested law corpus) — built Phase 1 from the RAG_SPEC design instead of applying a patch
- Single-source normalization: implementation moved to src/lib/arabic.mjs (shared ESM), arabic.ts = typed re-export — the server and the ingest CLI execute byte-identical tokenization (locks RAG-18 parity by construction)
- src/lib/rag/: chunker.mjs (line-anchored `المادة (N)` anchors + inline fallback, مكرر variants, chapter headings, articlePart splits >1200 chars, chunks:0 ⇒ job REJECTED — never papered over), store.mjs (4 additive tables + queries, manifestHash idempotency, BLOCKED_LAWS single source), embed.mjs (local-only Ollama-compatible client, graceful lexical-only degradation, cosine + RRF k=60), pipeline.mjs (manifest v1 validation → sha256 → policy block → chunk → LINKED (read-only LKB pointer) → embed → LAWYER_REVIEW/INDEXED), retriever.mjs (BM25 over chunks with cached index + explicit bust, temporal filter in SQL before scoring, versions current|historical|all, asOf, LKB enrichment, RagQueryLog hashes-only)
- Chunk-level version chain: newer text closes the older chunk's window (append-only, text never mutated). Fixed a real flaw found by repeat-run testing: re-ingesting an OLDER issue with same-hash content used to close the newer window then skip the insert (article vanished from current retrieval) — content identity is now checked first (getChunkByHash) and same-hash chunks never regress windows
- API: GET /api/rag/search (requireOrg), POST /api/rag/ingest (LAWYER/ADMIN only, dryRun, inbox-confined source read with traversal guard), GET /api/rag/status (coverage/jobs/Phase-0 parity/blocklist); RAG_ENABLED rollback switch (default true — documented deviation from the DELIVERABLES matrix, harness requires reachability)
- Persistence: sqlite.mjs DDL + scripts/pg/007_rag.sql (tables + least-privilege grants, bb_app SELECT/INSERT/UPDATE, bb_system ALL) + setup-embedded applies 007 + prisma models RagChunk/IngestJob/ProvisionAmendment/RagQueryLog (documented source of truth); pg ensureRagSchema skips CREATE when tables are provisioned (bb_system has no schema CREATE)
- CLI: scripts/rag-ingest.mjs (--manifest/--scan/--dry-run, dual-backend reaper pattern, exit 1 on refusal/block) + scripts/rag-build-inbox.mjs (deterministic corpus→inbox builder; attestation:false; issueNo/publishDate = mirror-snapshot metadata, never presented as gazette identity). Real corpus ingested: 902 chunks (16/1960: 318 parts/293 anchors, 17/1960: 263, 38/1980: 321) — 887 linked to live LKB provisions; idempotent re-run proven on both backends
- UI consumer (harness step 6, chose the related-laws panel — fits the panel architecture without inventing a route pattern): RelatedLaws.tsx on the case view — top-5 proposals from the case pleading text, unverified + provisional-mirror badges, per-hit resolve-through-/api/kb/resolve rendering the existing CitationBadge; browser-verified live (26-related-laws-rag.png: real hits 38/1980 م 283/237/209, 17/1960 م 171, 16/1960 م 283 against an execution-objection pleading; resolved chip shows "38/1980 — م 283 · غير مُتحقق")
- e2e: section [15] RAG-01..RAG-10, RAG-13 (engine-contract half; LLM-trace RAG-11/12/14 deferred with LLM_PROVIDER=off), RAG-15 (80/2026 BLOCKED_POLICY), RAG-16 (manifestHash idempotency), RAG-17 (LKB untouched), RAG-18 (tashkeel parity + lexical degradation + hash-only query log), sha-mismatch refusal, unique-per-run fixture law/markers (suite is state-safe across runs). Also fixed a latent suite bug: undefined `cookie` var in [11]F would crash on doc-light DBs (now jar.value)
- Verification gates (harness step 1, actual outputs): tsc diff vs pre-change baseline = EMPTY (26 pre-existing errors unchanged); eslint on all new/touched files = clean; e2e: fresh-DB cycle (rm db → seed → ingest-corpus 946 → rag-ingest 902) = 185/185 ALL CHECKS PASSED on SQLite; STORAGE_BACKEND=pg (+007 applied, corpus re-ingested 1024 provisions, RAG re-ingested linked) = 184/184 ALL CHECKS PASSED (1 sqlite-only raw-read sub-check skips by design). Dev server restored to default sqlite mode (health: corpus 868)
- Ops note: background processes now spawn via a self-exiting node spawner (reparent to PID 1) — setsid/nohup children were being reaped at tool-call boundaries and killed two pg e2e attempts; scripts/run-dev-e2e.sh + run-clean-e2e.sh encode the proven cycles. pg e2e needs this month's metered analysis.run rows reset (91 rows had saturated the FREE cap — test-data reset, not a check change)

Stage Summary:
- RAG Phase 1 implemented, ingested, retrieved, consumed, verified end-to-end on both storage backends with every harness hard constraint intact: LegalProvision remains the sole citation source (RAG-10/13 prove the grounding contract), verified:false discipline everywhere, 80/2026 blocklist un-weakened (RAG-15), no OCR/PDF/pgvector/LLM scope creep, no scraping in-app, only pre-existing deps used (zero new npm packages)
- Deliverables: src/lib/rag/* (5 modules + server-ctx), 3 RAG routes, rag-ingest/rag-build-inbox CLIs, RelatedLaws panel, 007_rag.sql + sqlite DDL + prisma models, docs/rag/IMPLEMENTATION_STATUS.md (implemented vs deferred + documented deviations), README RAG section, e2e 155→185
- Next candidates: RAG Phase R0 (pgvector + TEI compose profile, --reembed maintenance command, rag-eval gold set), lawyer Phase 0 sweep of the 1024-row queue + gazette re-attestation of the 902 provisional chunks, LLM phase (trace.ts + Layer-2 drafting) behind LLM_PROVIDER

---
Task ID: 10
Agent: Super Z (main)
Task: Connect Big Brother to new Convex deployment vivid-hare-882 and deploy the database schema

Work Log:
- Installed convex package (CLI 1.45.0) via npm
- Created convex/schema.ts mirroring all 19 Prisma models (organizations, users, memberships, billingEvents, notifications, legalProvisions, cases, caseEvents, documents, deadlines, packDrafts, acknowledgments, feedbacks, consents, auditLogs, orgEncryptionKeys, ragChunks, ingestJobs, provisionAmendments, ragQueryLog) with indexes for unique-constraint enforcement
- Created convex/provisions.ts: listByLaw/get/stats/upsert (unique triple enforcement via by_law_article_version; verified:false ingest gate) + verify (lawyer-only sign-off)
- Created .env.local: CONVEX_DEPLOYMENT=dev:vivid-hare-882, NEXT_PUBLIC_CONVEX_URL=https://vivid-hare-882.convex.cloud
- Added npm scripts: convex:push (dev), convex:deploy, convex:dev
- Attempted headless push: auth required. Device-authorization flow started (login poll, 10-min window)

Stage Summary:
- Repo fully wired for Convex; schema validated syntax-wise (push blocked only by auth)
- Awaiting user device authorization at https://auth.convex.dev/device, then `npx convex dev --once` pushes schema+functions to vivid-hare-882
- Note: convex deploy CLI 1.45 removed `push`; dev deployments use `convex dev --once`, prod uses `convex deploy`

---
Task ID: 10-completion
Agent: Super Z (main)
Task: Complete Convex deployment to vivid-hare-882

Work Log:
- Re-ran device-authorization flow after sandbox reset killed first session; user approved (~115s)
- Backed up auth token to scripts/convex-token-backup.json (survives home-dir resets)
- Pushed schema+functions: npx convex dev --once → all 20 tables + 30+ indexes created
- Verified live: npx convex run provisions:stats → {total:0, verified:0, unverified:0, active:0, laws:[]}

Stage Summary:
- Convex deployment vivid-hare-882 LIVE: https://vivid-hare-882.convex.cloud (dashboard: /t/almizanpro/big-brother/vivid-hare-882)
- 20 tables mirroring prisma/schema.prisma + convex/provisions.ts functions (listByLaw/get/stats/upsert/verify)
- Next: seed law corpus into Convex (upsert path ready) or swap app data layer (db.ts facade) — user decision

---
Task ID: 11
Agent: Super Z (main)
Task: Seed the laws into Convex vivid-hare-882

Work Log:
- Attached corpus (/home/z/uploads/law-corpus) was wiped by sandbox reset; pivoted to repo LKB
- Found authoritative LKB survived in data/big-brother.db: 995 provisions, 7 laws (16/1960, 17/1960, 38/1980, 51/1996, 67/1976, 9/2020, CITRA)
- Wrote scripts/dump_provisions.py (snake_case -> Convex docs, verified:false gate, epoch-ms createdAt, null-omitted optionals)
- ConvexHttpClient failed opaquely in Node; switched to `npx convex import --table legalProvisions` (CLI auth) -> 995 docs added
- Diagnosed deployment mismatch: first `convex dev --once` push landed on stray deployment, not vivid-hare-882; re-pushed with explicit CONVEX_DEPLOYMENT=dev:vivid-hare-882
- Verified: stats total=995 unverified=995; listByLaw 51/1996 = 14; active=868 (127 superseded version-chain rows preserved)

Stage Summary:
- Convex LKB seeded to full parity with SQLite source; all rows verified:false awaiting Phase 0 lawyer audit
- .gitignore now excludes convex token backup, login log, seed dump
- Stray empty deployment from misdirected first push may exist in dashboard — safe to delete

---
Task ID: 12
Agent: Super Z (main)
Task: Swap LKB data layer to Convex (go convex-native)

Work Log:
- Root-caused ConvexHttpClient 404: deployment is REGIONAL — real URL https://vivid-hare-882.eu-west-1.convex.cloud (fetch-spy on CLI traffic); fixed .env.local + scripts
- Extended convex/provisions.ts to full LKB surface: listAllActive, countActive, listByLawActive, listAllHistory, findActive, auditStats, kbStatsByLaw + verify/deactivate/reactivate/amend (amend transactional: v+1 insert + retire old)
- Pushed functions to vivid-hare-882 (explicit CONVEX_DEPLOYMENT)
- Created src/lib/convex.ts: server singleton ConvexHttpClient, lkbBackend() flag (default convex), mapConvexProvision (epoch ms -> ISO, mapProvision parity)
- db.ts: 12 LKB functions branch convex|sqlite; fixed latent never[] + unclosed brace in edited region
- e2e harnesses default LKB_BACKEND=sqlite (hermetic); smoke: /api/health corpus=868 via Convex
- e2e: 186/186 PASSED (exit 0)

Stage Summary:
- App LKB now reads/writes Convex vivid-hare-882 by default; SQLite path retained via LKB_BACKEND=sqlite (e2e + pg parity)
- Both backends verified at parity (868 active / 995 total)
- Follow-ups: Convex auth before public launch (deployment currently allows anonymous mutations); stray empty deployment in dashboard can be deleted

---
Task ID: 13
Agent: Super Z (main)
Task: Re-attach the two law files (corpus rebuild + separate ingest batch), lawyer Verification UI, Convex auth hardening

Work Log:
- Identity resolution (web-verified): no Kuwait law "25/1980" exists — the Civil Code is Decree 67/1980; "Rental 51/1996" was a mislabel (51/1996 = Personal Status; rental = Decree 35/1978). Recorded in corpus/SOURCES.json identityResolution.
- Fetched full texts from almohami.com mirrors (snapshots pinned at corpus/_raw/): Civil Code 1082/1082 articles (none missing), Rental 29/29. Built corpus/KW_CivilCode_67_1980_clean.json + corpus/KW_Rental_35_1978_clean.json via scripts/build-corpus-reattach.mjs (deterministic, sha256-pinned, verified_official:false).
- Separate ingestion batch: scripts/ingest-corpus.mjs → +1082/+29 provisions (verified:false); rag-build-inbox → 2 new drops; rag-ingest → MIRROR-67/1980 (1084 chunks) + MIRROR-35/1978 (39 chunks), both PROVISIONAL (attestation=false), 2 new LAWYER_REVIEW jobs.
- Convex sync (batch 2): re-dump (2107) + token-authenticated seed → 995 exists + 1112 created; Convex now total 2107 / 9 laws at parity; sqlite hermetic rebuild = 2106 (one legacy 16/1960 version-chain row delta).
- Auth hardening: convex/auth.ts requirePrivilegedToken (fail-closed) on upsert/verify/deactivate/reactivate/amend + new authPing probe; Convex-side auditLogs trail on every gated write; LAWYER_API_TOKEN (openssl rand -hex 32) set on deployment + .env.local (gitignored); src/lib/convex.ts privilegedToken() server-only; scripts pass token. scripts/verify-convex-auth.mjs: no-token refused, wrong-token refused, authPing ok, reads public.
- Verification UI: GET /api/kb/audit gains additive status/q/limit/offset params (bare response unchanged); new /verification page + VerificationQueue.tsx (Arabic RTL, login card, Phase 0 progress, law/status/search filters, 25-row pagination, verify + deactivate/reactivate dialogs, org switcher for LAWYER-role workspaces); AuditPanel gets updated law list + link to /verification.
- Smoke via Convex backend: health corpus=1980 active; /verification 200; lawyer login 200; queue paged (filteredTotal=1082 for 67/1980); anon 401; caseworker 403; bad-id 404 (fixed 500 by mapping Convex v.id validation errors to not-found in convexGetProvisionById); full token'd verify+deactivate on synthetic row ZZ/1900 TEST → 200/200, honest final state; row left archived as audit-trail artifact.
- e2e clean cycle (hermetic sqlite, incl. new corpus in pipeline): exit 0, ALL CHECKS PASSED (185 ✔ lines).
- Docs: docs/SECURITY-CONVEX.md (threat model, gate table, rotation runbook, residuals).

Stage Summary:
- LKB grew 995 → 2107 provisions on Convex (8 laws full-text + CITRA/9/2020 fixtures); RAG corpus 902 → 2025 chunks; both new laws enter the Phase 0 queue as PROVISIONAL mirror text (gazette identity pinning = lawyer work, attestation stays false).
- Convex deployment is no longer anonymously writable: all privileged mutations token-gated fail-closed with server-held LAWYER_API_TOKEN + Convex-side audit trail; reads intentionally public.
- Lawyers now have a dedicated paginated /verification screen (plus the in-app AuditPanel) with server-side filtering to handle the 2000+ row queue.
- Follow-ups: amend flow in /verification (API supports it); production deployment promotion before public launch; delete stray empty deployment on dashboard.

---
Task ID: 14
Agent: main (Super Z)
Task: GitHub push (PAT almizanpro-del) + Vercel production deployment (kosovohomes account) with push-triggered auto-deploy

Work Log:
- Verified credentials: fine-grained GitHub PAT -> almizanpro-del (admin on Big-Brother- repo, public); Vercel token -> kosovohomes (kosovohomes@gmail.com, orgId Fy5PMKmfojPoqOdXnfR55Mgq)
- Vercel-compat fixes committed (56ceab5): sqlite.mjs resolveDbPath() mirrors bundled DB into writable /tmp on Vercel (read-only FS + WAL would crash node:sqlite open; size-check re-copy per new deployment); next.config.ts outputFileTracingIncludes ships data/big-brother.db (7.6MB) in serverless bundles; package.json build made resilient to stripped standalone output + engines.node 22.x (node:sqlite needs >=22.5); sanity-tested both local and VERCEL=1 paths
- Vercel project big-brother (prj_NQWhczO1bb9THpur6KHGHArEtbdL) created via API; env vars set for production/preview: NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL, LKB_BACKEND=convex, LAWYER_API_TOKEN (encrypted)
- vercel git connect failed: Vercel GitHub App NOT installed on almizanpro-del (browser-only step, tokens cannot install GitHub Apps)
- First production deploy via CLI (remote build, 58s): https://big-brother-neon.vercel.app — HTTP 200; /api/health ok:true corpus:1980 (= active provisions incl. Task 13 mirror batch, proving Convex cloud LKB reads work from Vercel); protected routes correctly 401; /verification 200
- Both fine-grained PATs (new + old) 403 on Actions secrets API (no Actions permission) -> could not set VERCEL_TOKEN secret programmatically
- Built guarded Actions pipeline .github/workflows/deploy-vercel.yml (5df5980): on push to main + workflow_dispatch, vercel CLI remote-build prod deploy; no-ops with a notice until VERCEL_TOKEN secret exists; verified 2/2 runs trigger + complete on push (fine-grained PAT pushes DO trigger Actions here)
- All work pushed to GitHub main (f51c7cb..bffb6f9); standing policy adopted: push to GitHub after every completed unit of work

Stage Summary:
- Big Brother is LIVE on Vercel: https://big-brother-neon.vercel.app (production alias), serving the Convex-native LKB (1980 active provisions on vivid-hare-882)
- Auto-deploy is ARMED but needs one 30-second manual step (permission wall: neither PAT can write Actions secrets): add Actions secret VERCEL_TOKEN in repo settings -> pipeline then deploys on every push to main; OR install the Vercel GitHub App (https://github.com/apps/vercel/installations/new) for native git integration (then remove the Actions workflow to avoid duplicate deploys)
- Follow-ups: (a) arming auto-deploy via secret/App; (b) SQLite rows (users/cases/sessions) are ephemeral per lambda instance on Vercel — production tenants need Convex-full or Postgres backend (prisma/schema.prisma drivers); (c) data/dev-master.key is tracked in the PUBLIC repo — rotate before real client data

---
Task ID: 15
Agent: main (Super Z)
Task: "Proceed without questions till live + production-ready" — Convex prod deployment, KEK rotation/secrets hygiene, persistence push-button, regression + prod verification

Work Log:
- Convex PRODUCTION deployment created: blessed-otter-705 (npx convex deploy --yes). Functions+indexes pushed; LAWYER_API_TOKEN set on prod (matches Vercel value); dev snapshot exported (3223 docs: 2108 legalProvisions + 1115 auditLogs) and imported with --replace-all (zip table-id conflict solved via replace-all); provisions:stats on prod = 2108 total / 1980 active / 10 laws / 0 verified (Phase 0 queue intact)
- Vercel env flipped to prod Convex (NEXT_PUBLIC_CONVEX_URL/SITE_URL -> blessed-otter-705); direct POST /api/query probe on prod deployment confirms serving; site redeployed and healthy
- crypto.ts devMasterKey(): added KMS_DEV_MASTER_KEY_B64 env-value precedence (serverless read-only FS safe; file fallback retained; fail-closed EROFS if neither present); scripts/rotate-kek.mjs rotates the KEK by DEK re-wrap (same DEK material + key_versions -> field ciphertexts unchanged); rotated for real (4 rows re-wrapped, roundtrip decrypt of cases.opponent_pleading verified, backup .backups/)
- secrets hygiene: data/dev-master.key UNTRACKED from the public repo + gitignored (old key was public; new key lives in gitignored local file + encrypted Vercel env KMS_DEV_MASTER_KEY_B64); committed db re-wrapped (0af8740)
- persistence: Vercel Postgres can NOT be provisioned programmatically with a plain token (legacy /v1/storage/stores/nexus 404; marketplace needs interactive billing consent; existing store belongs to unrelated project loyalityforge — refused to reuse). Built push-button scripts/pg-provision-once.mjs: applies scripts/pg 001..007 (roles/RLS/grants/RAG), runs migrate-from-sqlite --to pg, flips STORAGE_BACKEND=pg + DATABASE_URL envs, redeploys, smoke-checks
- regression: run-clean-e2e.sh cycle = ALL CHECKS PASSED (185/185, exit 0); refreshed db committed (ebc2175); prod redeployed (jurcdggh9 -> alias big-brother-neon)
- prod verification: health ok (corpus 1980 via Convex prod); login lawyer@demo.kw/demo1234 SUCCESS; case list shows DECRYPTED opponentPleading (يدّعي الزوج...) -> KEK env + re-wrapped bundle proven server-side on Vercel

Stage Summary:
- Site is LIVE and production-hardened on the LKB axis: real Convex prod deployment (blessed-otter-705), rotated KEK, no secrets in repo, 185/185 e2e green
- Two manual steps remain (permission walls no token can cross): (1) add Actions secret VERCEL_TOKEN to arm push auto-deploy (pipeline verified 4/4 runs; deploys currently via CLI on demand); (2) create a Postgres in Vercel dashboard (Storage -> Create -> Neon Postgres -> attach to big-brother) then run scripts/pg-provision-once.mjs with DATABASE_URL to make tenant writes persistent (until then sqlite /tmp mirror is ephemeral per instance; LKB + lawyer verification are fully persistent via Convex)
- Follow-ups: KEK history exposure is now inert (old key wraps nothing); consider git history rewrite cosmetically; optional Vercel GitHub App install for native git integration (then remove Actions workflow to avoid double deploys)

---
Task ID: 16
Agent: main (Super Z)
Task: Production persistence cutover — tenant data (users/cases/sessions etc.) from ephemeral SQLite to Neon Postgres (user-provided DATABASE_URL), end-to-end RLS proof + production smoke

Work Log:
- Preflight (scripts/pg-neon-preflight.mjs): Neon = PostgreSQL 18.6; neondb_owner has CREATEROLE + BYPASSRLS; pgcrypto/vector available; session-level GUC retention probed under 6-way backend churn = 15/15 on BOTH pooled and unpooled endpoints. Decision: app/system roles use UNPOOLED direct connections (deterministic RLS session-GUC semantics under any load; pooled transaction-mode reassignment could silently fail-close or leak scope); PG_POOL_MAX=4 caps per-instance connections. neondb_owner NEVER used as app identity (BYPASSRLS would defeat tenant isolation).
- Provisioning (scripts/pg-provision-neon.mjs): pgcrypto extension; 001 roles created with generated passwords (ALTER ROLE); GRANT bb_migrator TO admin + SET ROLE so 002..007 (tables/indexes/RLS/SD-functions/grants/RAG) are OWNED BY bb_migrator (BYPASSRLS owner per PHASE_A_SPEC A2.1); ownership audit 22/22 objects; 20 tables with correct RLS flags (FORCE on tenant tables, plain on legal_provisions, none on rag_* globals); role smoke for bb_app/bb_system/bb_migrator. Credentials persisted to gitignored scripts/pg/.neon-credentials.json.
- Data migration: extended migrate-from-sqlite.mjs with the 4 RAG tables (rag_ingest_jobs, rag_chunks 2029 rows, provision_amendments, rag_query_log) — previous TABLES list only covered the 16 Phase-A tables which would have left pg RAG retrieval empty. Ran as bb_migrator --to pg: 20/20 tables count-verified (legal_provisions 2106, cases 10, users 9, audit_logs 100, org_encryption_keys 4, rag_chunks 2029, ...) + documents.hash sha256 spot-checks PASS.
- RLS verification on live Neon (scripts/pg-verify-rls.mjs): 16/16 PASSED — V1 fail-closed zero rows without GUCs (cases/users/provisions/notifications; org_encryption_keys = 42501 permission-denied, stronger than zero rows); V2 org scoping exact (2/2 cases) + P13 provisions readable only with user GUC; V3 cross-org case-by-id invisible; V4 foreign-org INSERT blocked (42501) while same-org INSERT passes WITH CHECK (ROLLBACK'd); V5 users UPDATE denied to bb_app; V6 bb_system BYPASSRLS lane + audit insert; V7 bb_migrator full visibility.
- Local app smoke (scripts/pg-smoke-app.mjs, dev server STORAGE_BACKEND=pg): 12/12 PASSED — health db=postgres corpus=1980 (Convex LKB coexists); login (system lane); case list; opponentPleading DECRYPTED (org DEK unwrap + GCM works against pg org_encryption_keys); create case 201 (bb_app INSERT + audit) + delete 200; notifications (P10). Initial 403 on lawyer create-case investigated and confirmed CORRECT business rule: on pg row order lawyer@demo.kw's default org is the NGO (role LAWYER, excluded by canManageCases); write probe switched to OWNER persona ahmed@demo.kw.
- Vercel cutover: STORAGE_BACKEND=pg + PG_POOL_MAX=4 created; DATABASE_URL_SYSTEM created (encrypted); marketplace-injected DATABASE_URL (neondb_owner, BYPASSRLS) OVERRIDDEN via POST ?upsert=true with the bb_app unpooled URL; prod redeployed via CLI.
- Production verification: /api/health {"db":"postgres","corpus":1980}; full smoke 12/12 PASSED against https://big-brother-neon.vercel.app — tenant writes now land in Neon and survive instance recycling. LKB + lawyer verification remain on Convex prod (blessed-otter-705) by design (LKB_BACKEND=convex).
- No app code changed (scripts + .gitignore only) — 185/185 e2e green state from task 15 remains valid; hermetic harness still defaults to sqlite.

Stage Summary:
- Big Brother is now PRODUCTION-PERSISTENT: tenant data lives in Neon Postgres (ep-winter-cloud-awl9m2kf) with the full Phase-A security model enforced at the DATABASE layer (RLS fail-closed, org isolation proven by 16 live probes), LKB on Convex prod, KEK rotation intact (org_encryption_keys migrated; DEK unwrap verified via decrypted Arabic pleading in prod).
- Role URLs: DATABASE_URL=bb_app (RLS-scoped tenant flows), DATABASE_URL_SYSTEM=bb_system (audited system ops), bb_migrator for migrations only; all passwords generated at provision time, stored ONLY in gitignored scripts/pg/.neon-credentials.json + Vercel encrypted env.
- Remaining manual item (unchanged): arm push auto-deploy via Actions secret VERCEL_TOKEN or Vercel GitHub App install.

---
Task ID: 17
Agent: main (Super Z)
Task: Security-headers audit + cookie Secure fix, deployed and browser-verified on production

Work Log:
- Live audit of https://big-brother-neon.vercel.app found: NO Content-Security-Policy, NO X-Frame-Options/frame-ancestors, NO X-Content-Type-Options, NO Referrer-Policy, NO Permissions-Policy, NO COOP/CORP; API responses cacheable (`cache-control: public, max-age=0`); session cookie shipped WITHOUT Secure (COOKIE_SECURE env-gated default false); Vercel static defaults leaked `access-control-allow-origin: *` + `content-disposition: inline` on HTML; HSTS already present (Vercel). x-powered-by absent.
- Implemented declarative baseline in next.config.ts headers() (no middleware — prerendered pages stay CDN-cacheable): source-restricted CSP (default-src 'self'; script/style 'self' + 'unsafe-inline' for Next hydration/inline styles — nonce-based CSP documented as upgrade path since it would force dynamic rendering; img-src + favicon CDN host z-cdn.chatglm.cn; connect-src self + *.convex.cloud/*.convex.site over https/wss for the Convex client; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests), X-Frame-Options DENY (legacy belt), nosniff, strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geo/payment/usb/display-capture/motion sensors/interest-cohort all denied), COOP/CORP same-origin, X-DNS-Prefetch-Control off; poweredByHeader:false; /api/:path* gets Cache-Control no-store.
- Cookie fix (src/lib/auth.ts sessionCookieOptions): Secure now defaults to NODE_ENV==='production' (COOKIE_SECURE explicit override retained) — Vercel prod/preview get Secure automatically; local http dev/e2e stays false without env changes.
- Deployed (CLI). Production verification: all headers present on / and /api/*; login Set-Cookie now `Secure; HttpOnly; SameSite=lax`; GET / 200.
- Headless-browser (agent-browser) functional verification under the new CSP: homepage hydration OK (login tabs/textboxes), NO console CSP violations; real login as ahmed@demo.kw succeeded (browser accepted Secure cookie); /verification renders the live Convex Phase-0 queue (إجمالي النصوص ١٬٩٨٠ via wss connect-src) with no CSP/WS violations or page errors.
- No e2e re-run needed for the harness itself (harness spawns dev-mode server → Secure=false path unchanged); 185/185 green state remains valid; app behavior deltas verified via the browser flow above.

Stage Summary:
- Production now carries a complete OWASP secure-headers baseline + source-restricted CSP verified non-breaking in a real browser, and session cookies are Secure-by-default in production.
- Known accepted trade-offs: script-src retains 'unsafe-inline' (Next static prerender constraint; upgrade = nonce CSP via middleware at cost of CDN caching), COEP intentionally omitted (no cross-origin subresources; require-corp adds breakage risk without benefit here), Vercel's static ACAO:* on prerendered HTML is harmless for public pages and partially masked by CSP frame-ancestors 'none'.
- Remaining manual item (unchanged): arm push auto-deploy via Actions secret VERCEL_TOKEN or Vercel GitHub App.

---
Task ID: 18
Agent: main (Super Z)
Task: Deployment-state investigation (user screenshot) + final e2e regression pass

Work Log:
- User screenshot showed Vercel deployments list with a "Status Error" quick-filter chip visible; all visible big-brother deployments Ready. Queried Vercel API to make it conclusive: the 6 account-level ERROR deployments belong to OTHER projects on the kosovohomes account (verified dpl_ETrpuLJ8... -> project "ommal" prj_tjJ2P1hlaFKdbuuut8FVliWVlnkW; account hosts ~19 projects incl. loyalityforge, lkc-app, islamic apps). big-brother (prj_NQWhczO1bb9THpur6KHGHArEtbdL) has ZERO errored deployments — every production deployment READY (incl. persistence cutover 4bd53d5 and security-headers 19336cc via CLI).
- Also noted from the API: LegalShield-named deployments share the account (unrelated to this repo).
- Final regression: ran scripts/run-clean-e2e.sh (hermetic sqlite clean cycle: wipe -> boot -> seed -> corpus ingest 2057 provisions -> RAG inbox ingest -> full e2e). Result: exit 0, 185/185 checks passed, ALL CHECKS PASSED — validates the security-headers + Secure-cookie changes introduced no regression.
- Refreshed data/big-brother.db committed per convention (matches ebc2175 precedent).

Stage Summary:
- Big Brother production deployment history is fully green (no action needed on the "Status Error" filter — it surfaces other projects' failures on the shared kosovohomes account).
- 185/185 e2e green AFTER the headers + cookie changes; production-ready checklist unchanged: only the VERCEL_TOKEN Actions secret (or Vercel GitHub App install) remains manual.
