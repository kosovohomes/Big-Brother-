# -*- coding: utf-8 -*-
# Technical Architecture Specification — content module 3 (Sections 6-9).

SEC6 = [
{'h1': '6. Safety and Compliance Gates'},
{'h2': '6.1 Minors / domestic-violence / coercion screening at intake'},
{'p': 'Intake today records consent and intake channel but performs no sensitive-case screening (src/app/api/cases/route.ts validates intakeChannel, consentText, subjectName only). The gate adds a deterministic screen at case creation over the signals the request already carries: subType and event hints, and keyword classes over free text (note, opponentPleading, subjectName context) covering minors (guardianship, infancy, and infant-custody markers), domestic violence (family-violence, protection, and restraint markers), and coercion (duress, threats, and impersonation markers). On detection the case is flagged sensitive_case with a class enum, and one of two dispositions applies per organization configuration: (a) <b>specialist-review routing</b> — the case enters the org\u2019s review workflow and reviewers with the LAWYER role are notified at creation, reusing the fan-out pattern and per-user inbox of notifyReviewersOfDraft() in src/lib/notifications.ts; or (b) <b>constraint mode</b> — the engine runs but relevance is capped at low, Layer-2 generation for counter/dismissal types is disabled, and every surface shows the existing "consult a lawyer" framing with an explicit "this case type needs specialist support" notice. The gate never blocks data entry or sealing (evidence preservation is a safety feature) and never produces a diagnosis; both dispositions are educational and route the user toward qualified help. NGO partners can be granted the specialist queue by the existing reviewQueueEnabled flag, which keeps the feature inside the current tenancy model.'},
{'h2': '6.2 Export-blocking rule for unreviewed high-stakes drafts'},
{'p': 'The export path (src/app/api/drafts/[id]/export) already enforces four gates: acknowledgment (428), finalize-before-export (409), cooling-off (423 with remainingSec), and the IN_REVIEW lock for review-queue orgs. One rule is added, none removed: <b>High-relevance dismissal grounds and misconduct/nazaha drafts cannot export unless lawyer-reviewed (status RELEASED) or the export is explicitly labeled DRAFT</b>. The unlabeled path returns 423 with a machine-readable body {reason: "lawyer_review_required", reviewRequired: true}; the labeled path proceeds only with a DRAFT watermark and the not-for-filing authority string stamped into the exported document and the acknowledgments record (which already snapshots banner text per export). This composes with the viability rule of Section 5.3: a dismissal draft whose high-relevance grounds lack required predicates is blocked from the unlabeled export regardless of draft age. All existing gates are preserved verbatim — acknowledgment at generation and export, 24h cooling-off clocks, review-queue release restrictions — and the 98-check suite already covers their absence paths.'},
{'h2': '6.3 Embedded output-policy text in every pack'},
{'p': 'The pack builders (src/lib/packs.ts) already embed the mandatory cover notice (draftCoverBilingual()), the relief-category disclaimer ("general information, NOT ready-to-file requests"), and registry information framed as public knowledge. The policy layer is unified into a single OUTPUT_POLICY block — bilingual, versioned like bannerVersion, and rendered at three positions: the cover, a footer line on every exported section, and the acknowledgment snapshot. The block states, at minimum: the document is educational; it is not a conclusion that any document is forged, any party is guilty, any professional committed misconduct, or any claim will be dismissed; citations marked unverified are pending lawyer audit; and no part of the document may be filed without independent legal review. Embedding the policy in the payload (rather than only the UI shell) means exports carry the policy even when rendered outside the app, which the PRD\u2019s export-time acknowledgment requirement implies.'},
]

SEC7 = [
{'h1': '7. API Contracts'},
{'p': 'The sketches below follow the conventions already established in the codebase: cookie session auth via requireOrg() (src/lib/api-helpers.ts), org scoping derived server-side, the error shape {error: string, ...context} used across the 38 existing handlers, the machine-readable 402 plan_limit convention of planLimitReached() preserved verbatim, and 423/428 for the compliance gates. New endpoints add an Idempotency-Key header convention for unsafe operations, stored against the acting org with a 24-hour replay window. Paths are grouped under /api to sit beside their sibling routes.'},
{'code': ('POST /api/documents/upload — multipart original to object storage + seal',
"""POST /api/cases/{caseId}/documents/upload
  Security: cookie session (requireOrg); role: case-manageable roles
  Params:  caseId (uuid, org-scoped)
  Request: multipart/form-data
    file        (binary, required; max 25 MB, mime allowlist)
    notes       (string, optional)
    Idempotency-Key (header, required for retries; 24h window)
  Processing:
    1. sha256(stream) server-side (same convention as documents POST)
    2. put object -> bb/org/{orgId}/case/{caseId}/doc/{docId}/v{n}
       (WORM object-lock; SSE with org DEK)
    3. insert documents row {hash, size, mime, object_key, version,
       previous_id} -> existing mismatch + metaRisk flow unchanged
    4. enqueue forensics job (OCR/EXIF/timeline checks -> metaRisk)
  201 {document: {id, hash, version, metaRisk, hashMismatch, objectKey}}
  402 {error:"plan_limit", limit:"maxDocsPerCase", ...}   <- planLimitReached
  404 case not in org | 413 too large | 415 mime rejected | 409 replay conflict""")},
{'code': ('GET/POST /api/rag — retrieval and lawyer-admin ingestion',
"""GET /api/rag/search
  Security: cookie session (requireOrg)
  Query:  q (string, required) | law (string, optional) | topic (string, optional)
          k (int, default 8, max 25) | asOf (ISO date, default now)
  Behavior: hybrid BM25 + vector over chunks; hard filters
    is_active = true AND effective_from <= asOf
    AND (effective_to IS NULL OR effective_to > asOf)
  200 {query, normalizedTokens, asOf, results: [
        {provisionId, lawId, articleNo, score, matchType, verified,
         label, snippet}]}          # provision ids resolve via /api/kb/resolve
  Notes: results are candidates only; display passes them through
         resolveRef() — never rendered as citations directly (PRD 6.3a)

POST /api/rag/ingest
  Security: cookie session + LAWYER or platform-admin role (lawyer-admin only)
  Request: {sourceUri | gazetteId, lawId?, licenseRef, dryRun?: bool}
  Behavior: staging fetch -> OCR queue -> article-anchored chunk ->
            embed -> index (idempotent per content hash)
  202 {jobId, chunksQueued} | 403 {error:"lawyer_admin_required"}
  409 {error:"license_gate", detail:"PRD 9.2 sign-off missing for source}""")},
{'code': ('POST /api/counter-reply/v2 — assertion pipeline + persisted traces',
"""POST /api/cases/{caseId}/counter-reply/v2
  Security: cookie session (requireOrg); Idempotency-Key required
  Request: {layer: "L1"|"L2", persist?: bool (default true)}
  Behavior: 5-stage pipeline (Section 5.1); opponent citations extracted
            and validated via resolveRef(); viability applied (5.3)
  200 {assertions: [{assertionId, kind, materiality,
        response: {positionAr, positionEn, basisAr, basisEn,
                   legalBasis: [{provisionId, ref, verified, label}],
                   evidenceRefs: [{docId, hash}],
                   traceId, needsHumanReview,
                   misstatedCitations: [{ref, reason}]}}],
        reevaluatedFrom?: [provisionId]}
  402 plan_limit (metered like analysis.run) | 404 | 428 (L2 without ack)""")},
{'code': ('POST /api/tenant/keys/rotate — envelope key rotation',
"""POST /api/tenant/keys/rotate
  Security: cookie session; OWNER role only; platform-admin for shredding
  Request: {orgId (must equal session org or explicit admin grant),
            mode: "rotate" | "retire" | "status"}
  rotate:  wrap new DEK version; re-wrap; lazy re-encrypt job enqueued
  retire:  block until re-encrypt drain; then destroy old DEK in KMS
  status:  {keyId, state, versions:[...], reencryptProgress}
  200 {keyId, state} | 403 {error:"owner_required"}
  Audit: keys.rotate / keys.retire entries via audit() (never shredded)""")},
{'p': 'Two conventions deserve emphasis because they bind the new endpoints to existing behavior. First, the 402 plan_limit body of planLimitReached() (limit, plan, max, upgradeTo, message) is reused as-is for metered new endpoints — retrieval and counter-reply v2 count against plan capacity, never against safety features. Second, idempotency: POST endpoints that create resources (upload, ingest, counter-reply persist, key rotate) accept Idempotency-Key and return the original response on replay with 409 reserved for conflicting reuse of a key with a different payload — the same guarantee recordBillingEvent() already provides for Stripe event ids via the unique ref index (src/lib/db.ts).'},
]

SEC8 = [
{'h1': '8. Deliverables and Sequencing'},
{'h2': '8.1 Phase A — Platform: Postgres, RLS, envelope crypto, object storage'},
{'p': 'Phase A is the platform swap with zero user-visible behavior change; the 98 existing checks pass against both drivers at the end of the phase.'},
{'table': {
 'caption': 'Table 8-1 — Phase A work breakdown',
 'widths': [0.20, 0.44, 0.18, 0.18],
 'header': ['Workstream', 'Contents', 'Rollback', 'Estimate'],
 'rows': [
 ['Postgres + adapter', 'PostgresAdapter behind StorageAdapter; prisma/schema.prisma brought to parity; dual-driver CI; copy migration script with checksum verification.', 'Feature-flagged driver; SQLite remains default until cutover sign-off.', '2 eng-weeks'],
 ['RLS hardening', 'Policies on all tenant tables; SET LOCAL app.org_id per transaction; BYPASSRLS migration role; leakage suite T-01..T-22 green.', 'RLS disabled via migration revert; app layer unchanged.', '1.5 eng-weeks'],
 ['Envelope crypto', 'org_keys table; Vault Transit integration (SoftHSM dev); field encryption on the Section 3.1 scope; rotation + retirement jobs; audit entries.', 'Plaintext columns retained during dual-write window; drop-encryption migration reverts.', '2 eng-weeks'],
 ['Object storage', 'MinIO deployment; multipart upload path on documents route; WORM lock; forensics worker (pg-boss) + OCR baseline; PA checks.', 'Upload path optional; hash-only flow preserved.', '2 eng-weeks'],
]}},
{'h2': '8.2 Phase B — Corpus: RAG ingestion, retrieval, catalogue migration'},
{'p': 'Phase B stands up the legal-content layer. The licensing gate (PRD 9.2 / 6.3a) is a precondition for bulk ingestion, not a parallel workstream — the pipeline runs against manually verified seed material until the gate opens. Workstreams: (1) ingestion service with article-anchored chunking and amendment linkage (Section 2.3); (2) embedding worker with the chosen model (Section 2.4) and pgvector HNSW index; (3) Retrieval API with temporal filtering and resolveRef-bound output (Section 2.5), replacing the in-memory BM25 path behind a flag while /api/search keeps its contract; (4) rule catalogue migration with golden-file parity and the RULES_SOURCE flag (Section 4.2); (5) interruption/suspension handling in Deadline Radar v2 (Section 4.3). Rollback per workstream is flag-based: retrieval falls back to lexical-only, catalogue falls back to compiled TS rules, and the Deadline Radar change is behind a catalogue-field presence check (empty interruption rules produce today\u2019s behavior).' },
{'h2': '8.3 Phase C — Intelligence: counter-reply v2 and the LLM service'},
{'p': 'Phase C ships the assertion-extraction pipeline with persistence and traces (Section 5), the export-blocking rule and intake safety gate (Section 6), and the self-hosted LLM service for Layer-2 language with per-sentence grounding (Section 2.6). Sequencing inside the phase matters: the deterministic pipeline ships first and becomes the Layer-1 floor; the LLM is introduced only as an optional Layer-2 renderer whose output is rejected unless every sentence carries a trace or an unverified mark. Rollback: counter-reply v2 endpoints are versioned (/v2) so the legacy template responses remain available; the LLM service can be disabled without touching the deterministic path.'},
{'h2': '8.4 e2e extension to 162 checks (target 160+)'},
{'p': 'The suite grows from 98 to 162 checks; the existing 98 pass unchanged in every phase. New checks are numbered by suite: T (tenant isolation, Section 3.3), PA (platform), PB (corpus), PC (intelligence).'},
{'num': [
 '<b>PA-01..PA-12 (Phase A, 12):</b> PA-01 document upload round-trip (object exists, hash matches row); PA-02 WORM lock rejects overwrite/append; PA-03 deleted-object recovery impossible within retention; PA-04 DEK wrap/unwrap round-trip; PA-05 rotation re-wraps without downtime; PA-06 retired key destroys old version after drain; PA-07 encrypted field unreadable with destroyed DEK (shred verification); PA-08 7-day deletion transitions tombstone to purge; PA-09 audit rows survive org shred; PA-10 RLS direct SQL cross-org SELECT returns zero rows (T-21/22 in CI); PA-11 PITR restore to 5 minutes before a seal restores consistent state; PA-12 dual-driver parity — 98 checks green on Postgres.',
 '<b>PB-01..PB-16 (Phase B, 16):</b> PB-01 gazette fixture ingests to article-anchored chunks (article numbers preserved); PB-02 amendment article creates supersedes linkage; PB-03 retrieval with asOf before amendment returns only the old version; PB-04 superseded article never retrieved at asOf=now; PB-05 deactivated (isActive=false) article never retrieved; PB-06 hybrid fusion ranks exact-article matches above generic mentions; PB-07 Arabic tokenizer parity (bare-form/definite-form matching) on the new corpus; PB-08 retrieval ids all resolve via /api/kb/resolve (no invented refs); PB-09 unresolved candidate discarded/badged, never rendered; PB-10 catalogue migration golden-file parity on 5 fixtures; PB-11 catalogue edit by non-lawyer rejected (403); PB-12 catalogue version chain retains history; PB-13 interruption rule tolls deadline correctly in a recess scenario; PB-14 counterargument renders when present; PB-15 embedding worker health + reindex idempotency; PB-16 lexical fallback serves when vector service is down.',
 '<b>PC-01..PC-14 (Phase C, 14):</b> PC-01 segmentation fixtures (5 Arabic pleadings) segment as expected; PC-02 classification precision on fixture set at or above threshold; PC-03 materiality ordering matches expected point order; PC-04 opponent citation extraction returns correct {lawId, article} pairs; PC-05 misstated citation flagged with neutral wording; PC-06 unresolved opponent citation never rendered as citation; PC-07 every response line joins to at least one trace row; PC-08 per-point evidence hash present (AC3); PC-09 missing predicate auto-downgrades relevance; PC-10 high relevance with missing predicates forces needsHumanReview; PC-11 export blocked without lawyer review (423 lawyer_review_required); PC-12 DRAFT-labeled export carries watermark + acknowledgment snapshot; PC-13 LLM sentence without grounding marked unverified and badged; PC-14 external-LLM payload scanner proves no case facts in outbound anonymized-rule requests.',
]},
{'p': 'Counting: 98 existing + 22 isolation + 12 + 16 + 14 = <b>162 checks</b>, meeting the 160+ target with margin. Each phase\u2019s checks are merged at phase exit, and the README\u2019s compliance matrix is updated in the same commit so documentation never drifts from the suite.'},
]

SEC9 = [
{'h1': '9. Decision Register — Only Humans Can Make These'},
{'p': 'The following decisions are outside engineering authority. Each is stated with the options on the table and the section of this specification it gates. They should be resolved in the order listed, because earlier decisions unblock phase work.'},
{'num': [
 '<b>Embedding-model hardware budget.</b> bge-m3 with a GPU (recommended for retrieval quality) versus multilingual-e5-large on CPU-only hosting (Section 2.4). Determines the Phase B infrastructure line item and the vector-store corollary (pgvector first, Qdrant if scale demands).',
 '<b>LLM model, GPU sizing, and license verification.</b> Qwen2.5-32B/72B-Instruct versus an Arabic-specialist family; AWQ quantization and serving capacity; license review for the selected weights (Section 2.6).',
 '<b>Lawyer validation pipeline.</b> Recruitment of 2-3 licensed Kuwaiti lawyers (civil, criminal, family), hours and headcount for the Phase 0 citation audit, the go/no-go rule the PRD already imposes (no advisors, no ground-relevance scoring or draft generation), and ownership of the rule-catalogue validation workflow (Sections 4.3, 9 of the PRD).',
 '<b>MoJ / Official Gazette data access and licensing.</b> The bulk-ingestion gate of PRD 9.2 and 6.3a: MoU or manual-entry-first for launch; which sources are reproducible and under what terms (Section 2.3).',
 '<b>Data residency and hosting region.</b> Confirmation of the MOJ/CITRA posture for case data, resolution of the PRD 6.3a self-hosting judgment call (C4) including whether the legal-content layer may ever touch external APIs, and procurement of the hosting environment (Sections 2.1, 2.6).',
 '<b>KMS custody and audit-trail encryption split.</b> HashiCorp Vault operational ownership, master-key ceremony custody, and counsel sign-off that audit_logs live outside the org envelope (Section 3.1) so crypto-shredding cannot erase compliance history.',
 '<b>Admission-category policy.</b> Whether the counter-reply response categories should ever include admission/qualified admission (PRD 5.6 AC2) or whether the current conservative deviation (never suggest admitting) is ratified as product policy (conflict C5).',
 '<b>Appeal-window validation sign-off.</b> The WINDOWS values in the catalogue (civil 40 / criminal 20 / family 30) require Phase 0 lawyer validation with gazette references — the family window is explicitly flagged "under verification" in the engine today (conflict C6).',
 '<b>Retention schedule.</b> The retention period applied to WORM-locked evidence objects and the interplay with the 7-day deletion workflow and Kuwaiti counsel\u2019s advice on evidence preservation duties (Sections 2.7, 3.4).',
]},
]
