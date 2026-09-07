-- =====================================================================
-- Phase A (A4.3) 002_tables.sql — mirrors src/lib/sqlite.mjs DDL 1:1
-- (same table/column names + Phase A additions) so the row mappers work
-- unmodified. TEXT ISO-8601 dates and SMALLINT booleans are kept in v1
-- (A1.2) so string comparisons in the suite pass unchanged on both
-- backends; timestamptz/boolean conversion is a separate later migration.
-- =====================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'INDIVIDUAL',
  plan TEXT NOT NULL DEFAULT 'FREE',
  plan_status TEXT NOT NULL DEFAULT 'active',
  plan_renews_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  join_code TEXT NOT NULL UNIQUE,
  review_queue_enabled SMALLINT NOT NULL DEFAULT 0,
  delete_scheduled_at TEXT,          -- A2.4 org offboarding
  deleted_at TEXT,                   -- tombstone
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ar',
  delete_scheduled_at TEXT,
  sessions_invalid_before TEXT,      -- C-A7 session revocation epoch
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER',
  UNIQUE (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS legal_provisions (
  id TEXT PRIMARY KEY,
  law_id TEXT NOT NULL,
  law_name_ar TEXT NOT NULL,
  law_name_en TEXT NOT NULL,
  article_no TEXT NOT NULL,
  amendment_version TEXT NOT NULL DEFAULT 'original',
  effective_from TEXT,
  effective_to TEXT,
  gazette_ref TEXT,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  text_ar TEXT NOT NULL,
  text_en TEXT NOT NULL,
  summary_ar TEXT NOT NULL DEFAULT '',
  summary_en TEXT NOT NULL DEFAULT '',
  topics TEXT NOT NULL DEFAULT '[]',
  verified SMALLINT NOT NULL DEFAULT 0,
  verification_note TEXT,
  verified_by TEXT,
  verified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS lp_unique ON legal_provisions(law_id, article_no, version);
CREATE INDEX IF NOT EXISTS lp_law_article ON legal_provisions(law_id, article_no);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  number TEXT DEFAULT '',
  court TEXT DEFAULT '',
  circuit TEXT DEFAULT '',
  case_type TEXT NOT NULL DEFAULT 'civil',
  sub_type TEXT NOT NULL DEFAULT 'execution',
  role TEXT NOT NULL DEFAULT 'defendant',
  filed_at TEXT,
  served_at TEXT,
  opponent TEXT,
  opponent_pleading TEXT,            -- A2.3: ciphertext under ENCRYPTION_ENABLED (enc:v1:...)
  subject_name TEXT,
  intake_channel TEXT NOT NULL DEFAULT 'self',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_org ON cases(org_id);

CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  note TEXT,
  appeal_filed SMALLINT NOT NULL DEFAULT 0,
  defect SMALLINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_case ON case_events(case_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  hashed_at TEXT NOT NULL,
  meta_risk TEXT NOT NULL DEFAULT 'LOW',
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  previous_id TEXT,
  created_at TEXT NOT NULL,
  storage_key TEXT,                  -- A3 (null = hash-only mode)
  storage_version_id TEXT,
  storage_class TEXT,
  retention_until TEXT,
  deleted_at TEXT,                   -- A2.4 metadata purge marker (WORM blob outlives; DEK shredded)
  virus_scan_status TEXT,
  virus_scan_at TEXT,
  idempotency_key TEXT               -- A3.2 upload idempotency
);
CREATE INDEX IF NOT EXISTS docs_case ON documents(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS documents_idem ON documents(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  due_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  provision_ref TEXT,
  completed SMALLINT NOT NULL DEFAULT 0,
  source_event_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deadlines_case ON deadlines(case_id);

CREATE TABLE IF NOT EXISTS pack_drafts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  payload TEXT NOT NULL,             -- A2.3: ciphertext under ENCRYPTION_ENABLED
  status TEXT NOT NULL DEFAULT 'DRAFT',
  finalized_at TEXT,
  released_at TEXT,
  exported_at TEXT,
  cooling_off_hours INTEGER NOT NULL DEFAULT 0,
  review_required SMALLINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_case ON pack_drafts(case_id);

CREATE TABLE IF NOT EXISTS acknowledgments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id TEXT,
  kind TEXT NOT NULL,
  banner_version TEXT NOT NULL DEFAULT 'v2.1',
  text_snapshot TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS acks_draft ON acknowledgments(draft_id);

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT,
  scope TEXT NOT NULL DEFAULT 'case_data',
  version TEXT NOT NULL DEFAULT 'v2.1',
  text_snapshot TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  user_id TEXT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_org ON audit_logs(org_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'FREE',
  detail TEXT,
  ref TEXT,
  seq BIGINT GENERATED ALWAYS AS IDENTITY   -- C-A5: rowid replacement for newest-first ordering
);
CREATE INDEX IF NOT EXISTS billing_org ON billing_events(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_ref ON billing_events(ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_ar TEXT,
  body_en TEXT,
  case_id TEXT,
  ref_type TEXT,
  ref_id TEXT,
  urgency TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  seq BIGINT GENERATED ALWAYS AS IDENTITY   -- C-A5
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe ON notifications(user_id, dedupe_key);

CREATE TABLE IF NOT EXISTS org_encryption_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  wrapped_dek TEXT NOT NULL,         -- DEK wrapped by the KMS KEK (never a raw key)
  state TEXT NOT NULL DEFAULT 'active',  -- active | retired | destroyed
  created_at TEXT NOT NULL,
  destroyed_at TEXT,
  UNIQUE (org_id, key_version)
);
