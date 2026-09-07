# -*- coding: utf-8 -*-
# Technical Architecture Specification — content module 2 (Sections 3-5).

SEC3 = [
{'h1': '3. Multi-Tenant Hardening'},
{'h2': '3.1 Per-tenant envelope encryption and KMS design'},
{'p': 'Today all tenants share one SQLite file with no encryption (Table 1-2). The target design is envelope encryption with a key hierarchy: a root master key held by a self-hosted KMS; per-organization data encryption keys (DEKs); and ciphertext at the field and object level. The recommended KMS is <b>HashiCorp Vault Transit</b> (self-hostable, audited key lifecycle, no plaintext keys ever leave the service); for developer machines a SoftHSM backend behind the same interface suffices. The application never sees a master key — it asks the KMS to unwrap a stored DEK inside the request path, caching unwrapped DEKs in memory for the process lifetime only.'},
{'p': 'Scope matters as much as mechanism. Encrypted under the org DEK: case narrative fields (cases.opponent_pleading, event notes, subject_name), voice-note transcripts, document originals (via MinIO SSE with per-org keys), and pack payloads. NOT encrypted: identifiers, org_id, timestamps, status fields — these must remain queryable for RLS, indexing, and the usage metering already implemented in getOrgUsage() (src/lib/db.ts). A new org_keys table (key_id, org_id, wrapped_dek, algo, state, created_at, rotated_at) records the hierarchy; every key operation is written to the audit trail via the existing audit() helper in src/lib/sqlite.mjs.'},
{'p': '<b>Rotation</b> is cheap by construction: rotating an org key wraps a new DEK version and re-wraps the old one (a metadata operation); re-encryption of data proceeds lazily on write and via a background job, with the old DEK held in state "retired" until the job drains. <b>Crypto-shredding</b> on offboarding destroys the org\u2019s DEKs, rendering every remaining ciphertext permanently unreadable even from backups. This must be reconciled with two existing obligations. First, the 7-day deletion workflow (PRD 5.10, implemented in src/app/api/data/delete): the shredding job runs only after the 7-day grace window completes and rows are purged, so a cancelled deletion still finds its data readable. Second, the immutable audit trail: audit_logs are deliberately kept OUTSIDE the envelope — they contain pseudonymous ids, actions, and detail strings rather than case content, and they are encrypted under a separate platform audit key that is never shredded. Without this split, crypto-shredding an org would silently destroy the compliance history that PRD 6.7 requires to survive. This reconciliation decision is flagged for counsel sign-off in Section 9.'},
{'h2': '3.2 Defense-in-depth isolation: RLS, middleware, tests'},
{'p': 'Isolation today rests on a single layer: requireOrg() in src/lib/api-helpers.ts derives the session, looks up the org, checks membership, and every query hand-writes an org_id predicate. That is correct but fragile — one forgotten WHERE clause is a breach. The target adds two more layers around the same interface. Layer 1 (application guard) stays: requireOrg() is unchanged, and a shared query helper makes org-scoped predicates the default rather than the discipline. Layer 2 (database) is Postgres RLS: tenant tables enable ROW LEVEL SECURITY with a policy of the form org_id = current_setting(\u0027app.org_id\u0027, true); the PostgresAdapter opens each request transaction with SET LOCAL app.org_id, so a forgotten WHERE can no longer leak rows. Migrations run under a separate BYPASSRLS role that the application never uses. Layer 3 (verification) is the cross-tenant leakage suite of Section 3.3, executed in CI against the Postgres driver.'},
{'h2': '3.3 Cross-tenant leakage test suite (added to scripts/e2e.mjs)'},
{'p': 'The suite below extends the existing e2e patterns — two workspaces are created, the attacker logs into workspace A and probes resources owned by workspace B using forged ids, switched sessions, and enumeration. The 22 checks are numbered for direct implementation; each asserts the negative result (404/403/401, or zero rows) and, where relevant, that the audit log recorded the attempt.'},
{'num': [
 'T-01 GET /api/cases/{B-case-id} from A returns 404 and no field leakage in the error body.',
 'T-02 PATCH /api/cases/{B-case-id} from A returns 404; B-side row unchanged afterwards.',
 'T-03 GET /api/cases/{B-case-id}/analysis from A returns 404 and no analysis.run audit row for B.',
 'T-04 GET /api/cases/{B-case-id}/events from A returns 404.',
 'T-05 POST event into B case from A returns 404.',
 'T-06 POST document seal into B case from A returns 404; no documents row created.',
 'T-07 GET /api/drafts/{B-draft-id} from A returns 404.',
 'T-08 POST /api/drafts/{B-draft-id}/export from A returns 404.',
 'T-09 POST /api/drafts/{B-draft-id}/release from A (even with lawyer role in A) returns 404.',
 'T-10 GET /api/cases/{B-case-id}/deadlines-ics from A returns 404.',
 'T-11 POST /api/notifications {id: B-notification-id} from A marks 0 rows (recipient-scoped update).',
 'T-12 GET /api/notifications from A never returns rows whose orgId belongs to B.',
 'T-13 POST /api/auth/switch-org {orgId: B-org-id} without membership returns 403 and leaves the active org unchanged.',
 'T-14 POST /api/auth/switch-org {joinCode: forged-guess} returns 4xx; 10 rapid guesses all fail consistently (enumeration resistance).',
 'T-15 Tampered session cookie (payload byte flipped, HMAC invalid) yields 401 on every org-scoped route.',
 'T-16 Session cookie re-signed for another uid (key unknown to attacker — simulated by replaying A\u2019s cookie against B\u2019s resources) still yields 404s; no id-based access.',
 'T-17 MEMBER role POST /api/billing/checkout in own org returns 403 (privilege escalation resistance).',
 'T-18 MEMBER POST /api/kb/audit/{id} verify returns 403 (role gate holds across orgs).',
 'T-19 GET /api/data/export from A returns only A-org cases; row count equals A\u2019s case count.',
 'T-20 GET /api/audit from A returns only A-org log rows.',
 'T-21 (Postgres driver) direct SQL under the app role with app.org_id=A cannot SELECT B rows (RLS unit test in CI).',
 'T-22 (Postgres driver) unsetting app.org_id in-session yields zero tenant rows (no silent fallback to superuser semantics).',
]},
{'h2': '3.4 Onboarding and offboarding runbook'},
{'table': {
 'caption': 'Table 3-1 — Tenant lifecycle runbook (each step audited via audit())',
 'widths': [0.14, 0.43, 0.43],
 'header': ['Phase', 'Steps', 'Controls'],
 'rows': [
 ['Onboard', '1. Create organization (POST /api/orgs) — type, plan, reviewQueueEnabled. 2. Issue join code (auto). 3. Owner membership. 4. Provision org DEK in KMS. 5. Create MinIO prefix bb/org/{orgId} with object-lock default. 6. Set white-label fields. 7. Seed RLS binding (org row exists).', 'Join-code entropy check; DEK creation logged; storage prefix policy lock verified; first-login acceptance of consent version (consents table).'],
 ['Operate', 'Plan changes via /api/billing (ledger + webhook idempotency); membership changes restricted to OWNER/ADMIN; usage meters from getOrgUsage().', '402 plan_limit convention preserved; safety features never gated (billing.ts design note).'],
 ['Offboard', '1. Owner requests workspace deletion (mode: workspace). 2. 7-day grace: login blocked for members, export available to owner. 3. Day 7: purge rows, delete objects (versioned), release MinIO prefix. 4. Crypto-shred org DEKs in KMS. 5. Tombstone org row (slug reserved).', 'Shred only after purge completes; audit rows survive (kept under platform audit key); join code invalidated; webhook-driven cancellations reconciled via billing ledger refs.'],
 ['Restore', 'Within grace window: owner cancel restores access; keys and objects untouched.', 'Single audit entry, no partial state (transactional in PostgresAdapter).'],
]}},
{'h2': '3.5 White-label fields on Organization'},
{'p': 'The organizations table (src/lib/sqlite.mjs DDL; prisma/schema.prisma Organization model) gains presentation fields so NGOs and law firms can brand their workspace without code changes: display_name, logo_url, primary_color, default_locale (ar default), custom_domain, footer_text_ar, footer_text_en, theme_json. They are surfaced read-only through /api/auth/me (activeOrg payload) and editable via an OWNER/ADMIN-gated PATCH on /api/orgs. Custom domains resolve through a host-header middleware that looks up the org by custom_domain and pins the session\u2019s allowed orgs — a thin extension of the existing switch-org trust model. All fields are tenant-scoped data and therefore inside the envelope-encryption scope decision of Section 3.1 (logo and colors are not sensitive; they are excluded for queryability, which the spec notes explicitly to keep the encryption scope list honest).'},
]

SEC4 = [
{'h1': '4. Rule Catalogue Migration'},
{'h2': '4.1 Target: a declarative, versioned rule catalogue'},
{'p': 'The 28 rules currently live as a compiled TypeScript array (src/lib/rules/catalog.ts: RULES, plus LAW, WINDOWS, FORGERY_RULE, EVENT_TYPES). Every addition or Phase 0 correction requires a redeploy, and the catalogue lacks fields the brief requires — counterarguments, interruption/suspension rules, viability scoring, and validation metadata. The target is a declarative catalogue stored in Postgres (mirrored in the dev SQLite DDL) and validated by a schema on load. The requested fields map onto the following table definition; existing RuleDef fields are carried over 1:1 so nothing is lost in translation.'},
{'code': ('RULE CATALOGUE — TABLE DDL (Postgres; SQLite mirror in sqlite.mjs)',
"""CREATE TABLE rule_catalogue (
  rule_id            TEXT PRIMARY KEY,        -- 'CIV-SERV-005'
  law_id             TEXT NOT NULL,           -- '38/1980'
  track              TEXT NOT NULL,           -- civil | criminal | family
  category           TEXT NOT NULL,           -- service | limitation | ...
  statement_ar       TEXT NOT NULL,           -- from RuleDef.ar
  statement_en       TEXT NOT NULL,           -- from RuleDef.en
  display_articles   JSONB NOT NULL,          -- from RuleDef.articles
  article_refs       JSONB NOT NULL,          -- [{lawId, article}] for resolveRef
  required_predicates JSONB NOT NULL,         -- from RuleDef.predicates
  procedural_vehicle JSONB NOT NULL,          -- {ar, en}
  timing_constraints JSONB NOT NULL,          -- {ar, en} + machine fields
  interruption_suspension JSONB NOT NULL DEFAULT '[]',
  counterarguments   JSONB NOT NULL DEFAULT '[]',
  viability_scoring  JSONB NOT NULL DEFAULT '{}',
  default_severity   TEXT NOT NULL,           -- high | medium | low
  validation_status  TEXT NOT NULL DEFAULT 'pending',  -- Phase 0 states
  validator          TEXT,                    -- lawyer id|name stamp
  validated_at       TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  supersedes_id      TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (rule_id, version)
);
-- WINDOWS moves here too: (track, kind, days, validation_status, validator,
-- validated_at, version) so hardcoded appeal windows become auditable data.""")},
{'p': 'The JSON Schema mirror of this table lives beside the code (rules/schema.json) and is enforced by the loader with zod-style validation: an invalid rule (missing predicate text, unknown track, article_refs failing LKB shape) fails closed at startup in dev and is quarantined in prod, never silently ignored. The catalogue version chain reuses the pattern amendProvision() already established for the LKB — new version inserted, old row retired, history never overwritten (PRD 6.3a change management).'},
{'h2': '4.2 Engine reads the catalogue; behavior stays byte-compatible'},
{'p': 'A RuleProvider interface (list(track), get(rule_id)) is injected into analyze(c, provisions, rules) with a default of the current compiled RULES, so the existing signature remains source-compatible for every caller (src/app/api/cases/[id]/analysis/route.ts passes the provider; tests pass fixtures). The migration script dumps the current 28 rules to seed JSON (exact TS-to-JSON field mapping: id to rule_id, ar/en to statement_ar/en, articles to display_articles, refs to article_refs, predicates to required_predicates, vehicle to procedural_vehicle, timing to timing_constraints, severity to default_severity) and inserts them at version 1 with validation_status="pending" — honest Phase 0 state. A feature flag RULES_SOURCE=db|ts keeps both paths available until parity is proven.'},
{'p': 'Parity is defined mechanically: five fixture cases (the two seeded demo cases plus three synthetic civil/criminal/family timelines) produce golden-file analyze() outputs — alerts, grounds, deadlines byte-identical pre- and post-migration; the existing 98 e2e checks must pass unchanged, which the brief explicitly requires. New catalogue fields start empty and are populated during Phase B lawyer validation (validation pipeline is a human decision, Section 9); the engine ignores them until present, so enabling the DB source cannot change output.'},
{'h2': '4.3 What the catalogue unlocks'},
{'p': 'Three sections of this specification depend on this migration. Deadline Radar v2 reads interruption_suspension to toll or suspend windows (court recess, service suspension, adjournment-linked pauses), replacing the fixed WINDOWS addition in deriveDeadlines() — the confirmed gap of Table 1-2 — while keeping the "verify with a lawyer" framing on every derived deadline. Counter-Reply v2 (Section 5) reads required_predicates for the automatic viability downgrade and counterarguments to render educational "what the other side may argue" context. The Phase 0 audit gains a work surface: validation_status/validator/validated_at turn rule verification into the same lawyer-signed, gazette-referenced workflow the LKB already has in /api/kb/audit.'},
]

SEC5 = [
{'h1': '5. Counter-Reply v2'},
{'h2': '5.1 Assertion-extraction pipeline (replaces the regex parser)'},
{'p': 'The current parser (src/lib/counterReply.ts) splits on punctuation and classifies by four Arabic cue regexes; it neither extracts the opponent\u2019s citations nor scores materiality, and its responses are templates keyed by class. Counter-Reply v2 replaces this with a five-stage pipeline in which the regex stage survives only as the deterministic Layer-1 fallback, preserving the existing educational behavior when no model is configured.'},
{'num': [
 '<b>Segmentation:</b> Arabic-aware sentence segmentation (enders: period, exclamation, the Arabic question mark, semicolon, newline; plus connector-word heuristics) producing atomic assertions; the current ASSERTION_CUE split becomes the degenerate case.',
 '<b>Classification:</b> assertion classes remain the stable five — allegation, citation, relief, evidence, fact (the AR_CUES vocabulary) — each with a confidence; cue-based classification is the floor, an optional local classifier the floor when configured.',
 '<b>Materiality scoring:</b> a deterministic score per assertion (class weight, severity of any referenced rule, track weighting) that orders the point-by-point table and drives which points are summarized in Layer-1; scoring inputs stay inside the case workspace.',
 '<b>Opponent-citation extraction:</b> legal-reference patterns for Arabic pleadings (article-number forms: "m" + number, "law no. x/year" constructions, decree/regulation citations, range citations) are extracted as candidate {lawId, article} pairs with verbatim spans.',
 '<b>Validation against the LKB:</b> every extracted pair passes through the existing resolveRef() semantics (src/lib/engine.ts; /api/kb/resolve): resolved+verified renders with its badge; resolved+unverified renders badged pending Phase 0; unresolved is never displayed as a citation. A resolved citation whose article range or text contradicts the opponent\u2019s claimed content is explicitly flagged "misstated provision — the cited text does not match the current official text" in neutral educational language; the system never asserts that the opponent lied (UPL boundary, PRD 9.3).',
]},
{'h2': '5.2 Trace IDs and the response table (PRD 5.6 AC3)'},
{'p': 'Every response line gets a trace_id at generation time, and persistence makes the AC3 table queryable rather than a transient payload. Two tables, mirrored into prisma/schema.prisma:'},
{'code': ('COUNTER-REPLY V2 — RESPONSE AND TRACE SCHEMA',
"""CREATE TABLE counter_responses (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id),
  case_id            TEXT NOT NULL REFERENCES cases(id),
  assertion_id       INTEGER NOT NULL,       -- point number in the pleading
  point_text         TEXT NOT NULL,          -- opponent's point (verbatim span)
  kind               TEXT NOT NULL,          -- allegation|citation|relief|evidence|fact
  materiality        REAL NOT NULL DEFAULT 0,
  position           TEXT NOT NULL,          -- response category (bilingual JSON)
  response_text      TEXT NOT NULL,          -- bilingual JSON {ar, en}
  legal_basis        JSONB NOT NULL,         -- [{provision_id, ref, verified, label}]
  evidence_refs      JSONB NOT NULL,         -- [{doc_id, hash, name}] per AC3
  trace_id           TEXT NOT NULL,
  layer              TEXT NOT NULL,          -- L1 | L2
  needs_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TEXT NOT NULL
);
CREATE TABLE response_traces (
  trace_id       TEXT NOT NULL,
  response_id    TEXT NOT NULL REFERENCES counter_responses(id),
  kind           TEXT NOT NULL,   -- extracted_text | provision | evidence_hash
  provision_id   TEXT,            -- when kind = provision
  evidence_hash  TEXT,            -- when kind = evidence_hash
  span           TEXT,            -- verbatim source span
  created_at     TEXT NOT NULL
);""")},
{'p': 'This closes conflict C2: the point-by-point payload of buildDraftPayload() (src/lib/packs.ts) is populated from counter_responses rows, so each point carries its own evidence reference + hash exactly as AC3 specifies, while the consolidated integrity page remains for the whole pack. The response layer also creates the substrate for conflict C1: rows record the provision ids they rely on, which is what the amendment re-evaluation job of Section 5.3 scans.'},
{'h2': '5.3 Viability rules and amendment re-evaluation'},
{'p': 'Viability becomes mechanical. The catalogue\u2019s required_predicates (Section 4) are matched against the satisfied-predicate evidence already computed by buildGround() (engine.ts passes satisfiedPredicates into GroundItem today). When required predicates are missing, relevance downgrades automatically one band (high to medium to low) with a bilingual explanation of which predicate is unmet — extending, not replacing, the existing "relevance is not a legal determination" framing (types.ts GroundItem comment). A dismissal-relevant item may only render at high relevance when all required predicates are satisfied OR when needs_human_review is forced true, which renders the item behind the mandatory "needs human lawyer review" state — the existing needsReview flag on GroundItem, now load-bearing.'},
{'p': 'Amendment re-evaluation closes conflict C1 end to end. When amendProvision() publishes version v+1 and retires v (src/lib/db.ts), a job scans counter_responses.legal_basis and persisted ground citations for the retired provision id, marks the affected rows re-evaluate=true, and notifies the owning users through the existing notifyUser() machinery (src/lib/notifications.ts) with a dedupe key of the form provision:{id}:amended — idempotent by the same unique index that powers deadline reminders. Previously viewed analyses and drafts are thereby flagged exactly as PRD 6.3a requires, without any retroactive mutation of history.'},
]
