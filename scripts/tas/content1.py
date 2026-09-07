# -*- coding: utf-8 -*-
# Technical Architecture Specification — content module 1 (Sections 1-2).
# Every proposal cites the existing file/module it extends or replaces.

SEC1 = [
{'h1': '1. Current-State Assessment'},
{'p': 'This assessment is a verified inventory, not a restatement of documentation. Every row below was checked against the actual source in the repository at commit time: the storage layer (<b>src/lib/sqlite.mjs</b> with its typed facade <b>src/lib/db.ts</b>), the analysis engine (<b>src/lib/engine.ts</b>), the rule catalogue (<b>src/lib/rules/catalog.ts</b>), the output builders (<b>src/lib/packs.ts</b>, <b>src/lib/counterReply.ts</b>), the platform services (<b>src/lib/billing.ts</b>, <b>src/lib/notifications.ts</b>, <b>src/lib/arabic.ts</b>), the 38 route handlers under <b>src/app/api/**</b>, and the compliance smoke test <b>scripts/e2e.mjs</b>. The README claims a 98-check e2e suite; this was verified literally — the file contains exactly 98 <b>check()</b> invocations across 11 sections, and the full suite was executed against the running dev server on localhost:3000 with the result <b>ALL CHECKS PASSED</b>. Where the PRD (<b>upload/Big_Brother_PRD_v2.1.md</b>) and the code disagree, the disagreement is flagged in Section 1.3 instead of being assumed away.'},

{'h2': '1.1 Verified inventory of what exists'},
{'table': {
 'caption': 'Table 1-1 — Verified component inventory (all paths relative to repository root)',
 'widths': [0.22, 0.50, 0.28],
 'header': ['Capability', 'Verified implementation', 'Key modules'],
 'rows': [
 ['Multi-tenancy', 'orgId scoping on every business table (cases, documents, deadlines, drafts, notifications, billing_events); org context derived server-side from the HMAC-signed session cookie on every call; roles OWNER/ADMIN/CASEWORKER/LAWYER/MEMBER; active-org switching with membership check.', 'src/lib/sqlite.mjs (DDL, FK cascades); src/lib/api-helpers.ts requireOrg(); src/app/api/auth/switch-org/route.ts'],
 ['Legal Knowledge Base', '48 seeded provisions across CPL 38/1980, CrCL 17/1960, Penal 16/1960, E-service 9/2020, Personal Status 51/1996; version chain (version, supersedes_id, effective_from/to, gazette_ref); verified=false default; lawyer-only verify / amend (publishes v+1, supersedes, history retained) / deactivate / reactivate.', 'prisma/schema.prisma (LegalProvision); src/lib/db.ts verifyProvision(), amendProvision(); src/app/api/kb/audit/**'],
 ['Citation resolver', 'Exact then range matching of {lawId, article} against the LKB; unresolved refs carry resolved:false and are never displayed as citations (hallucination guard, PRD 6.3).', 'src/lib/engine.ts resolveRef(); src/app/api/kb/resolve/route.ts'],
 ['Deterministic engine', 'Pure function analyze(CaseData, ProvisionT[]) returning alerts, grounds, deadlines; baseline grounds always surfaced (systematic completeness, PRD 5.5 AC1); no network, no model calls.', 'src/lib/engine.ts analyze(), buildGround()'],
 ['Rule catalogue', '28 rules hardcoded in TypeScript (9 civil, 5 criminal, 14 family) with predicates, procedural vehicle, timing, severity; appeal/opposition WINDOWS table flagged [JUDGMENT CALL] pending Phase 0.', 'src/lib/rules/catalog.ts; src/lib/types.ts RuleDef'],
 ['Two-layer output', 'Layer 1 educational view is default; Layer 2 draft packs require a non-dismissible acknowledgment at generation (428 when absent) and again at export; draft types carry authority strings ("not for filing").', 'src/lib/packs.ts DRAFT_TYPES, buildDraftPayload(); src/app/api/cases/[id]/drafts; src/app/api/drafts/[id]/export'],
 ['Cooling-off + review queue', '24h cooling-off for misconduct/nazaha drafts (423 with remainingSec), lawyer-only release; NGO orgs with reviewQueueEnabled route drafts to IN_REVIEW; caseworker release blocked 403.', 'src/lib/db.ts PackDraft columns; src/app/api/drafts/[id]/finalize|release|export'],
 ['Evidence sealing', 'SHA-256 seal with version chain (previous_id) and mismatch flagging; metaRisk LOW/MEDIUM/HIGH heuristic that never asserts forgery; engine rolls risky docs into AL-FORGERY alerts citing Penal Arts. 257-260.', 'src/app/api/cases/[id]/documents; src/lib/engine.ts; src/lib/notifications.ts notifyDocumentIntegrity()'],
 ['Billing and plans', 'FREE/PRO with capacity limits enforced server-side at 4 choke points; machine-readable 402 plan_limit body; Stripe REST checkout + webhook HMAC verification with event-id idempotency; demo mode without keys; billing ledger with unique ref.', 'src/lib/billing.ts; src/lib/db.ts setOrgPlan(), getOrgUsage(); src/app/api/billing/**'],
 ['Notifications', 'Per-user inboxes (nothing org-wide); dedupe_key idempotency; deadline reminders escalate soon/critical/overdue with new rows per band; event hooks for review requests, releases, hash mismatch, high meta risk.', 'src/lib/notifications.ts; src/app/api/notifications/**'],
 ['Arabic search', 'BM25 over the LKB rebuilt in-memory per request; tokenizer strips the definite article (al-), light suffix stemmer, Arabic-Indic digit folding; fixes the v0.1 recall bug.', 'src/lib/arabic.ts; src/app/api/search/route.ts'],
 ['Deadline Radar', 'deriveDeadlines() computes appeal windows from judgment events and surfaces upcoming sessions; urgency buckets; iCal export endpoint.', 'src/lib/engine.ts; src/lib/ical.ts; src/app/api/cases/[id]/deadlines-ics'],
 ['Audit + data rights', 'audit() writes audit_logs on every meaningful action; JSON data export; workspace wipe (Section 5.10 workflow); consent records for intake and voice notes.', 'src/lib/sqlite.mjs audit(); src/app/api/data/export|delete; src/app/api/audit'],
 ['Compliance e2e', '98-check API smoke suite verified passing (health, auth, search fix, resolver, Layer-1, ack gates, cooling-off, review queue, Phase 0 audit, billing, notifications).', 'scripts/e2e.mjs'],
]}},

{'h2': '1.2 Confirmed gaps'},
{'p': 'Each gap in the working brief was verified against the code before being accepted. The list below is the confirmed set, with the evidence that justifies each entry. These are gaps relative to the target architecture in Section 2 — none of them is a compliance regression: all existing guardrails (acknowledgment gates, cooling-off clocks, unverified badges, audit trail) are present and tested.'},
{'table': {
 'caption': 'Table 1-2 — Confirmed gaps with code evidence',
 'widths': [0.26, 0.50, 0.24],
 'header': ['Gap', 'Evidence in current code', 'Severity'],
 'rows': [
 ['No vector retrieval', 'src/app/api/search/route.ts rebuilds a lexical BM25 index in memory on every request over active provisions only; no embedding model or vector store exists anywhere in the stack.', 'High — semantic recall ceiling'],
 ['No full-law corpus', 'Corpus is 48 curated provisions (scripts/seed.mjs, src/lib/seed-data/*.json); rules cite ranges (e.g. 38/1980 arts. 33-42) for which only fragmentary rows exist.', 'High — blocks Phase 0 scale'],
 ['No document-original storage', 'The documents table stores hash, size, mime, meta_risk only; uploaded bytes are hashed and discarded; there is no object reference column.', 'High — chain-of-custody ceiling'],
 ['No OCR / forensics worker', 'No OCR path exists; the only media pipeline is voice-note ASR intake with consent; meta_risk is assigned from user-supplied notes and hash comparisons, not from file analysis.', 'Medium'],
 ['Regex-based counter-reply', 'src/lib/counterReply.ts segments via the ASSERTION_CUE regex and classifies via a 4-pattern Arabic cue list (AR_CUES); template responses per kind; opponent citations are never extracted or validated.', 'High — PRD 5.6 AC1 shortfall'],
 ['No per-tenant encryption', 'One SQLite file at data/big-brother.db (src/lib/sqlite.mjs DatabaseSync); no field-level or envelope encryption; all tenants share one file.', 'High for SaaS posture'],
 ['Single SQLite file', 'Same evidence as above; WAL mode is on, but there is one writer host, no RLS, no point-in-time recovery, no concurrent multi-node reads.', 'High at production scale'],
 ['Hardcoded TS rule catalogue', 'RULES is a compiled TypeScript array in src/lib/rules/catalog.ts; adding a rule requires a redeploy; no validation_status, counterarguments, or viability fields.', 'Medium — Phase 0 blocker'],
 ['No interruption/suspension in Deadline Radar', 'deriveDeadlines() adds fixed WINDOWS[track].appeal days to the judgment date (src/lib/engine.ts); court closures, suspension events, and tolling are not modelled, even though CIV-LIM-004 references interruption of limitation.', 'Medium — wrong dates risk'],
 ['No minors/DV safety gate', 'POST /api/cases validates intake channel and consent only (src/app/api/cases/route.ts); there is no sensitive-case screening or specialist-review routing at intake.', 'High — safety gap'],
]}},

{'h2': '1.3 PRD-versus-code conflict register'},
{'p': 'The working rules for this specification require flagging rather than assuming wherever a PRD claim and code reality conflict. Five such conflicts were identified. They are recorded here, referenced by the sections that resolve them, and carried into the decision register in Section 9 where a human sign-off is required.'},
{'table': {
 'caption': 'Table 1-3 — Flagged conflicts between PRD v2.1 claims and code reality',
 'widths': [0.08, 0.44, 0.48],
 'header': ['ID', 'PRD claim', 'Code reality and disposition'],
 'rows': [
 ['C1', 'PRD 6.3a change management: when a law is amended, existing analyses, alerts, and drafts referencing the superseded version must be flagged for re-evaluation and affected users notified.', 'amendProvision() in src/lib/db.ts supersedes versions correctly, but no impact scan or notification exists. Resolved in Section 5.3 via response persistence + a re-evaluation job reusing src/lib/notifications.ts.'],
 ['C2', 'PRD 5.6 AC3: the point-by-point table includes the user\u2019s evidence reference + hash per row.', 'packs.ts pointByPoint rows carry position, basis, articles, relief, verified — but no per-row evidence hash mapping; hashes appear only on the consolidated integrity page. Partial implementation; resolved in Section 5.2.'],
 ['C3', 'PRD success metric: at least 95% of citations resolve to a VERIFIED LKB entry.', 'verified = 0/48 by design pending Phase 0, so the metric is 0% today. Expected tension, not a defect; tracked by the Phase 0 progress bar (/api/kb/stats).'],
 ['C4', 'PRD 6.3a [JUDGMENT CALL] splits "self-hosted": case data needs region-compliant private hosting; the legal-content layer is a licensing problem and need not be self-hosted.', 'The working brief for this specification mandates all new services self-hosted with no case data leaving the deployment. This spec adopts the stricter reading; the PRD\u2019s looser split remains open for human confirmation (Appendix E-2).'],
 ['C5', 'PRD 5.6 AC2: response categories are admission / qualified admission / denial.', 'buildResponse() in src/lib/counterReply.ts never offers admission — the system never suggests admitting the opponent\u2019s allegation. Intentional conservative deviation; kept, and recorded as a product decision.'],
 ['C6', 'PRD Appendix E-9: appeal windows are judgment calls pending lawyer validation.', 'WINDOWS in src/lib/rules/catalog.ts hardcodes civil 40 / criminal 20 / family 30 days; the family window is labeled "under verification" in the engine\u2019s own alert strings. Must be resolved by the Phase 0 audit; Section 4.3 moves windows into the versioned catalogue.'],
]}},
{'p': 'Two claims in the working brief itself were also verified rather than assumed. The characterization of the counter-reply parser as regex-based is accurate (see Table 1-2). The figure of 98 e2e checks is accurate and all 98 pass; the target in Section 8 grows the suite to 162 checks without changing the semantics of the existing 98.'},
]

ARCH_TEXT = """                    +---------------------------------+
                    | Client - RTL bilingual SPA      |
                    | (AppShell, 11 panels)           |
                    +----------------+----------------+
                                     |
                     HTTPS, HMAC session cookie  [T]
                                     |
                    +----------------v----------------+
                    | Next.js 16 API layer            |
                    | requireOrg() guard, 402 gates,  |
                    | sets RLS app.org_id per tx      |
                    +---+------------+------------+---+
          [P]           |            | [T]        |          [T]
        +---------------+---+   +----v------+   +-v---------------+
        | Retrieval API     |   | Analysis  |   | Draft builders  |
        | hybrid BM25 +     |   | Engine    |   | packs.ts + LLM  |
        | pgvector, as-of   |   | (PURE)    |   | svc (Layer-2)   |
        | temporal filter   |   | engine.ts |   | trace/sentence  |
        +----+---------+----+   +-----+-----+   +----+-------+----+
             | [P]       [P]          | [P]           | [T]    | [T]
             |                        |               |        |
   +---------v----------+   +---------v---------------v----+   |
   | Gazette/MOJ ingest |   | Postgres 16 + pgvector       |   |
   | OCR worker         |   | RLS: org_id = app.org_id     |   |
   | article chunks     |   | LKB versions | cases | ...  |   |
   +--------------------+   +------------------------------+   |
                                                              [T]
                                            +-----------------v-----+
                                            | MinIO object store    |
                                            | WORM object-lock, SSE |
                                            | originals + forensics |
                                            +-----------------------+"""


SEC2 = [
{'h1': '2. Target Architecture'},
{'h2': '2.1 Platform decisions and the Postgres migration path'},
{'p': 'Next.js 16 App Router with TypeScript remains the application platform; nothing in the current route-handler architecture (<b>src/app/api/**</b>, 38 handlers) needs to change shape. The decisive platform change is storage: Postgres 16 becomes the production datastore, while node:sqlite stays the developer default. The migration is justified by four concrete deficits verified in Section 1.2, none of which SQLite can fix: (a) row-level security for defense-in-depth tenant isolation (Section 3.2) — SQLite has no equivalent; (b) concurrent multi-node reads and writes for a multi-tenant SaaS with NGO and law-firm workspaces; (c) pgvector for the retrieval service (Section 2.4); and (d) point-in-time recovery and managed backups, which a single WAL-mode file cannot provide.'},
{'p': 'The migration path preserves the existing seams. <b>src/lib/db.ts</b> is already the only typed facade over the storage layer, and <b>prisma/schema.prisma</b> already documents every model in Prisma form as a portability statement (its header says exactly this). The path is therefore: (1) keep the DDL in <b>src/lib/sqlite.mjs</b> as the dev schema and mirror each new table in <b>prisma/schema.prisma</b>; (2) introduce a StorageAdapter interface with two implementations — SqliteAdapter (current SQL, unchanged behavior) and PostgresAdapter (parameterized SQL against Postgres with RLS session variables set per transaction); (3) select the adapter by environment (DATABASE_DRIVER=sqlite|postgres), so dev keeps running with zero services and CI runs the same 98-check suite against both drivers; (4) migrate data with a one-shot copy script that maps the snake_case DDL of sqlite.mjs onto the Postgres schema. No route handler changes its imports; only db.ts internals change.'},
{'h2': '2.2 Where the engine stays pure, and where services attach'},
{'p': 'The current engine boundary is the most valuable architectural property in the codebase and it is preserved verbatim: <b>src/lib/engine.ts</b> exports analyze(c: CaseData, provisions: ProvisionT[]) — a pure function with no I/O, no clock dependence beyond its explicit today() input surface, and no model calls. Layer 1 output is deterministic and reproducible, which is what makes the 98-check suite stable and the compliance posture auditable. This specification does not move the engine.'},
{'p': 'New services attach strictly at the API layer, feeding the engine or the Layer-2 draft builders with material that has already been resolved and verified: the Retrieval API supplies candidate provision IDs that are passed through the existing resolveRef() semantics before display; the LLM service produces Layer-2 draft language whose every sentence carries a trace (Section 2.6); the forensics worker enriches document metadata that the engine already consumes through the metaRisk field (the AL-FORGERY rollup in engine.ts reads d.metaRisk). Rule text flows inward (public corpus), case facts never flow outward to third parties (tenant-scoped), which is the data-sensitivity boundary drawn in Figure 2-1.'},
{'h2': '2.3 RAG pipeline service (self-hosted ingestion to indexed store)'},
{'p': 'A dedicated ingestion service owns the path from official sources to the indexed store. Sources are the Kuwait Official Gazette (Kuwait Al-Youm — the gazette reference format already recorded on provisions, e.g. the e2e fixture "Kuwait Al-Youm, 1996 supplement") and the Ministry of Justice legal portal, subject to the licensing gate the PRD already imposes (Section 9.2: "no bulk indexing of restricted MOJ source text without a resolved licensing/data-use position"). The PRD\u2019s manual-entry-first pattern remains the fallback and the Phase 0 path; the pipeline below is the scale path once licensing is signed.'},
{'num': [
 '<b>Acquisition:</b> scheduled fetchers download gazette issues and MOJ legislation pages to a staging bucket; each artifact is content-hashed (SHA-256, reusing the hashing convention of src/lib/sqlite.mjs) and recorded in an ingest_jobs table with source URL, issue date, and license note.',
 '<b>Arabic OCR:</b> scanned pages pass through the OCR/forensics worker (Section 2.8) — Tesseract ara traineddata as the baseline, with an optional layout-aware model — producing text with page coordinates; confidence below threshold is flagged for human review rather than silently indexed.',
 '<b>Article-anchored chunking:</b> the chunker segments law text at article boundaries — one chunk per article (or per bounded article range), each chunk carrying law_id, article_no, version, effective_from, effective_to, amendment_version, and the heading trail (book/part/section) as inherited context. This preserves exactly the fields the LegalProvision table already models (prisma/schema.prisma), so a chunk resolves 1:1 onto an LKB row.',
 '<b>Amendment linkage:</b> amendment articles ("Article X is replaced by...") create supersedes edges between chunk versions, mirroring the supersedes_id chain that amendProvision() already maintains for the LKB; the chunk store never overwrites history, matching PRD 6.3a.',
 '<b>Embedding and indexing:</b> chunks are embedded (Section 2.4) and written to the vector store together with their lexical representation; indexing is idempotent per content hash.',
]},
{'h2': '2.4 Embedding model and vector store — two options each, with tradeoffs'},
{'p': 'The PRD constrains the choice: retrieval is a matching aid only (6.3a), candidates must resolve to exact LKB entries, and hosting must keep case data inside the deployment. Both options below are open-weight and self-hostable; both are Arabic-capable; the tradeoff is retrieval quality versus serving weight.'},
{'table': {
 'caption': 'Table 2-1 — Self-hostable Arabic-capable embedding options',
 'widths': [0.16, 0.30, 0.27, 0.27],
 'header': ['Option', 'Profile', 'Strengths', 'Tradeoffs'],
 'rows': [
 ['BAAI/bge-m3 (MIT)', '568M params, 1024-dim dense + learned sparse + ColBERT multi-vector; multilingual with strong Arabic retrieval results.', 'One model yields dense and sparse signals (natural fit for hybrid retrieval); best Arabic recall of the two; single container for the whole indexing pipeline.', 'Largest memory footprint (~2.3 GB fp32); GPU recommended for batch indexing throughput; multi-vector mode needs extra storage if enabled (can be disabled).'],
 ['intfloat/multilingual-e5-large (MIT)', '560M params, 1024-dim dense only; XLM-R backbone with query:/passage: prefix convention.', 'Simplest serving (ONNX int8 quantizes well for CPU-only deployments); long-standing, well-understood behavior; slightly lower latency.', 'Dense-only — Arabic keyword fidelity depends entirely on the separate BM25 leg; generally a step behind bge-m3 on Arabic retrieval benchmarks; prefix convention must be enforced in code.'],
]}},
{'p': 'Recommendation: bge-m3 where a GPU (even a single 24 GB card) is budgeted, because its sparse leg strengthens Arabic legal-term matching alongside BM25; multilingual-e5-large where the deployment is CPU-only. The vector store has the same two-option shape: <b>pgvector</b> inside the Phase A Postgres (HNSW indexes, transactional with the RLS-scoped data, one fewer service to run, pre-filtering on isActive/effective dates is a plain SQL WHERE) versus <b>Qdrant</b> (purpose-built hybrid search with payload filters, easier horizontal scaling, but a second stateful service and a synchronization burden with the LKB). Recommendation: pgvector first — it matches the Phase A platform and the corpus size (thousands to low millions of chunks); move to Qdrant only if corpus or QPS outgrows it. Both choices are listed in the human decision register (Section 9).'},
{'h2': '2.5 Retrieval API — hybrid, temporally filtered, resolveRef-bound'},
{'p': 'The Retrieval API (contract in Section 7) exposes hybrid search: BM25 over the chunk store and kNN over vectors, reciprocal-rank fused. Two properties are non-negotiable. First, <b>temporal validity</b>: every query carries an as-of instant (defaulting to now) and the store filters isActive = true AND effective_from less-or-equal as-of AND (effective_to IS NULL OR effective_to greater-than as-of), so superseded articles are never retrieved for current-law questions; historical questions may opt in by passing an explicit as-of date. This closes the gap flagged in Table 1-2 — today the search route filters only is_active (src/app/api/search/route.ts calls getAllActiveProvisions()), while effective_from/effective_to are recorded but unused in retrieval. Second, <b>resolution discipline</b>: the API returns provision IDs plus scores; it never renders text as a citation. Consumers pass candidate IDs through the existing resolveRef() (src/lib/engine.ts) — the exact semantics of /api/kb/resolve — so a retrieval hit that fails to resolve to a current LKB row is discarded or badged "unverified", never displayed. This is the PRD 6.3a rule that retrieval output is never shown directly as a citation.'},
{'p': 'The Arabic tokenizer of <b>src/lib/arabic.ts</b> is reused as the lexical leg\u2019s analyzer (definite-article strip, light stemmer, digit folding), which keeps query normalization identical between the legacy in-app search and the new retrieval service — the v0.1 bare-form/definite-form recall fix must not regress when the corpus grows a thousandfold.'},
{'h2': '2.6 LLM service — self-hosted, Layer-2 only, trace-per-sentence'},
{'p': 'The LLM service is self-hosted and open-weight, served behind an OpenAI-compatible API by vLLM on the deployment\u2019s own GPU. Recommended primary: <b>Qwen2.5-32B-Instruct</b> (Apache-2.0; strong Arabic generation; fits a single 40-48 GB GPU with AWQ quantization, or two 24 GB cards) with a documented scale path to Qwen2.5-72B-Instruct when hardware allows; a lighter Arabic-specialist alternative (e.g. jais-family) is viable for CPU-constrained deployments. Final model selection, GPU budget, and license verification are human decisions (Section 9). The service is used ONLY for Layer-2 discussion-draft language — Layer 1 remains the deterministic engine — and only with retrieval-grounded prompting: the prompt contains resolved provision text from the LKB, never free web text.'},
{'p': 'Every generated sentence must carry a trace before it can render: the draft builder emits per-sentence records {span, provision_id, evidence_hash, extracted_text} or marks the sentence verified:false, and the UI renders unverified sentences with the existing unverified badge convention (the ResolvedCitation label machinery in engine.ts and the pack payload). External LLM APIs are permitted only for anonymized rule text — never case facts — which is the strict reading of PRD 6.3a\u2019s hosting clause adopted in C4.'},
{'h2': '2.7 Object storage for document originals (S3-compatible, WORM)'},
{'p': 'A self-hosted MinIO cluster provides S3-compatible object storage with versioning and object-lock. Bucket layout mirrors tenancy: bb/org/{orgId}/case/{caseId}/doc/{docId}/v{n}, with object-lock (COMPLIANCE mode) applied to sealed evidence objects so originals are immutable for the retention period, and server-side encryption wired to the per-org envelope keys of Section 3.1. Integration with the existing hash chain is additive: the documents route (src/app/api/cases/[id]/documents) gains a multipart mode that (1) computes SHA-256 server-side exactly as today, (2) writes the object, (3) stores object_key alongside the existing hash/size/mime/meta_risk/version/previous_id columns, and (4) keeps the mismatch flagging and notifyDocumentIntegrity() behavior unchanged. Hash-only rows remain valid for documents that never upload originals, preserving backward compatibility with the 98-check suite. The PRD 5.10 deletion workflow reconciles as follows: workspace deletion starts the existing 7-day window; at completion, objects are deleted (versioned delete markers) while the hash-only seal records remain in the audit trail as non-personal evidence that sealing occurred.'},
{'h2': '2.8 OCR / forensics worker'},
{'p': 'A queue-driven worker (pg-boss on the Phase A Postgres, avoiding an extra broker service) consumes uploaded originals and produces structured metadata: EXIF-style creation/modification dates, producer software, page count, and OCR text. It then runs <b>timeline contradiction checks</b> — comparing file timestamps and in-document dates against the case timeline (case_events, which deriveDeadlines() already orders by date) — and proposes metaRisk upgrades through the same LOW/MEDIUM/HIGH vocabulary the documents table already stores. Outputs feed metaRisk only; the worker never emits forgery conclusions, matching the engine\u2019s existing language ("we do not conclude forgery — we flag irregularity risk", engine.ts AL-FORGERY alert) and PRD 5.4 AC3. All findings attach to the document\u2019s evidence hash so every forensic claim is traceable.'},
{'h2': '2.9 The same diagram as text'},
{'p': 'This section gives the explicit text form of the architecture requested for this specification, followed by the rendered diagram. Arrow labels carry the data-sensitivity class used throughout this document: [T] tenant-scoped case facts, [P] public rule text.'},
{'code': ('ARCHITECTURE — TEXT FORM', ARCH_TEXT)},
{'fig': ('diagram.png', 'Figure 2-1 — Target architecture with data-sensitivity labels on every flow. All services are self-hosted; case facts (tenant-scoped) never leave the deployment, while rule text (public corpus, license-gated) flows inward only.')},
]
