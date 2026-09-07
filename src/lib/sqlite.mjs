// Shared SQLite layer — plain JS (importable by both the Next.js server via
// db.ts and standalone Node scripts). Zero external deps; uses node:sqlite.

import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

// Serverless (Vercel) compatibility: the deployed function bundle is mounted
// read-only and node:sqlite opens READWRITE (WAL below also needs a writable
// file). On a Vercel cold start we mirror the bundled, seeded DB snapshot into
// the ephemeral writable /tmp and open that instead. LKB reads/writes are
// served by Convex (lkbBackend default 'convex'), so /tmp ephemerality only
// affects demo users/cases rows — production tenants require a persistent
// store (prisma/schema.prisma: Postgres driver or Convex full migration).
function resolveDbPath() {
  const bundled = join(DATA_DIR, 'big-brother.db');
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    try {
      const tmp = join('/tmp', 'big-brother.db');
      if (existsSync(bundled)) {
        // Re-copy when the bundled snapshot changed (new deployment) so warm
        // instances do not serve a stale corpus from a previous release.
        if (!existsSync(tmp) || statSync(tmp).size !== statSync(bundled).size) {
          copyFileSync(bundled, tmp);
        }
        return tmp;
      }
    } catch { /* fall through to bundled path */ }
  }
  return bundled;
}

export const DB_PATH = resolveDbPath();

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------- DDL ----------
db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'INDIVIDUAL', plan TEXT NOT NULL DEFAULT 'FREE',
  plan_status TEXT NOT NULL DEFAULT 'active',
  plan_renews_at TEXT,
  stripe_customer_id TEXT, stripe_subscription_id TEXT,
  join_code TEXT NOT NULL UNIQUE, review_queue_enabled INTEGER NOT NULL DEFAULT 0,
  -- Phase A org offboarding (crypto-shredding workflow): mirrors the user-level
  -- 7-day pattern on users.delete_scheduled_at (docs/PHASE_A_SPEC.md A2.4).
  delete_scheduled_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Phase A (A2.3): per-org envelope-encryption data keys. wrapped_dek holds the
-- DEK wrapped by the KMS KEK — never a raw key. state: active | retired |
-- destroyed (crypto-shredded: wrapped bytes overwritten, DEK unrecoverable).
CREATE TABLE IF NOT EXISTS org_encryption_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  wrapped_dek TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  destroyed_at TEXT,
  UNIQUE(org_id, key_version)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'ar',
  delete_scheduled_at TEXT,
  -- Phase A (C-A7): sessions issued BEFORE this epoch are invalid — logout and
  -- account-deletion revoke every stateless cookie issued earlier.
  sessions_invalid_before TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'MEMBER', UNIQUE(user_id, org_id)
);
CREATE TABLE IF NOT EXISTS legal_provisions (
  id TEXT PRIMARY KEY, law_id TEXT NOT NULL, law_name_ar TEXT NOT NULL, law_name_en TEXT NOT NULL,
  article_no TEXT NOT NULL, amendment_version TEXT NOT NULL DEFAULT 'original',
  effective_from TEXT, effective_to TEXT, gazette_ref TEXT,
  title_ar TEXT NOT NULL, title_en TEXT NOT NULL, text_ar TEXT NOT NULL, text_en TEXT NOT NULL,
  summary_ar TEXT NOT NULL DEFAULT '', summary_en TEXT NOT NULL DEFAULT '',
  topics TEXT NOT NULL DEFAULT '[]',
  verified INTEGER NOT NULL DEFAULT 0, verification_note TEXT,
  verified_by TEXT, verified_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT, is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS lp_unique ON legal_provisions(law_id, article_no, version);
CREATE INDEX IF NOT EXISTS lp_law_article ON legal_provisions(law_id, article_no);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, number TEXT DEFAULT '', court TEXT DEFAULT '', circuit TEXT DEFAULT '',
  case_type TEXT NOT NULL DEFAULT 'civil', sub_type TEXT NOT NULL DEFAULT 'execution',
  role TEXT NOT NULL DEFAULT 'defendant',
  filed_at TEXT, served_at TEXT, opponent TEXT, opponent_pleading TEXT,
  subject_name TEXT, intake_channel TEXT NOT NULL DEFAULT 'self',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_org ON cases(org_id);

CREATE TABLE IF NOT EXISTS case_events (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  date TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'other',
  note TEXT, appeal_filed INTEGER NOT NULL DEFAULT 0, defect INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_case ON case_events(case_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mime TEXT,
  hashed_at TEXT NOT NULL, meta_risk TEXT NOT NULL DEFAULT 'LOW', notes TEXT,
  version INTEGER NOT NULL DEFAULT 1, previous_id TEXT, created_at TEXT NOT NULL,
  -- Phase A (A3) object-originals: all NULL when OBJECT_STORAGE_ENABLED=false
  -- (hash-only mode — today's behavior and the sandbox default).
  storage_key TEXT,
  storage_version_id TEXT,
  storage_class TEXT,
  retention_until TEXT,
  deleted_at TEXT,
  virus_scan_status TEXT,
  virus_scan_at TEXT,
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS docs_case ON documents(case_id);

CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title_ar TEXT NOT NULL, title_en TEXT NOT NULL, due_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom', provision_ref TEXT,
  completed INTEGER NOT NULL DEFAULT 0, source_event_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deadlines_case ON deadlines(case_id);

CREATE TABLE IF NOT EXISTS pack_drafts (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_id TEXT NOT NULL,
  type TEXT NOT NULL, title_ar TEXT NOT NULL, title_en TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
  finalized_at TEXT, released_at TEXT, exported_at TEXT,
  cooling_off_hours INTEGER NOT NULL DEFAULT 0, review_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_case ON pack_drafts(case_id);

CREATE TABLE IF NOT EXISTS acknowledgments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id TEXT, kind TEXT NOT NULL, banner_version TEXT NOT NULL DEFAULT 'v2.1',
  text_snapshot TEXT NOT NULL, accepted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS acks_draft ON acknowledgments(draft_id);

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, target_id TEXT NOT NULL, value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, target_id)
);

CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT, scope TEXT NOT NULL DEFAULT 'case_data', version TEXT NOT NULL DEFAULT 'v2.1',
  text_snapshot TEXT NOT NULL, accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, org_id TEXT, user_id TEXT,
  at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_org ON audit_logs(org_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  at TEXT NOT NULL, kind TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'FREE',
  detail TEXT, ref TEXT
);
CREATE INDEX IF NOT EXISTS billing_org ON billing_events(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_ref ON billing_events(ref) WHERE ref IS NOT NULL;

-- Stage 6: per-user notification inbox. Nothing is org-wide: each member only
-- ever sees rows addressed to them (privacy default), and dedupe_key makes
-- reminder generation idempotent (unique per user+key).
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title_ar TEXT NOT NULL, title_en TEXT NOT NULL,
  body_ar TEXT, body_en TEXT,
  case_id TEXT,
  ref_type TEXT, ref_id TEXT,
  urgency TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe ON notifications(user_id, dedupe_key);

-- RAG Phase 1 (docs/RAG_SPEC.md §4.1) — purely additive corpus/retrieval
-- tables. rag_chunks are RETRIEVAL PROPOSALS ONLY: LegalProvision remains
-- the sole citation source. rag_query_log never stores query text.
CREATE TABLE IF NOT EXISTS rag_ingest_jobs (
  id TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL UNIQUE,
  issue_no TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'txt',
  source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  attested INTEGER NOT NULL DEFAULT 0,
  ocr_engine TEXT,
  stats TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  provision_id TEXT,
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
  embedding TEXT,
  ocr_engine TEXT,
  ocr_confidence REAL,
  ingest_job_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
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
  action TEXT NOT NULL,
  gazette_issue TEXT,
  gazette_date TEXT,
  new_provision_id TEXT,
  applied_at TEXT,
  detected_by TEXT NOT NULL DEFAULT 'pipeline',
  approved_by TEXT,
  ingest_job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS prov_amend_target ON provision_amendments(target_law_id, target_article);
CREATE TABLE IF NOT EXISTS rag_query_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  query_hash TEXT NOT NULL,
  latency_ms INTEGER,
  embed_mode TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rag_query_log_org ON rag_query_log(org_id);
`);

// ---------- lightweight migrations (existing DBs) ----------
// Add Phase 0 audit columns to legal_provisions when upgrading a pre-existing DB.
(function migrateProvisionAuditColumns() {
  const cols = db.prepare('PRAGMA table_info(legal_provisions)').all().map(c => c.name);
  for (const [name, ddl] of [
    ['verified_by', 'TEXT'],
    ['verified_at', 'TEXT']
  ]) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE legal_provisions ADD COLUMN ${name} ${ddl};`);
    }
  }
})();

// Phase A: tenant-hardening columns for pre-existing DBs (C-A7 sessions,
// A2.4 org offboarding, A3 object-originals + upload idempotency).
(function migratePhaseAColumns() {
  const addCols = (table, cols) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [name, ddl] of cols) {
      if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl};`);
    }
  };
  addCols('users', [['sessions_invalid_before', 'TEXT']]);
  addCols('organizations', [['delete_scheduled_at', 'TEXT'], ['deleted_at', 'TEXT']]);
  addCols('documents', [
    ['storage_key', 'TEXT'], ['storage_version_id', 'TEXT'], ['storage_class', 'TEXT'],
    ['retention_until', 'TEXT'], ['deleted_at', 'TEXT'],
    ['virus_scan_status', 'TEXT'], ['virus_scan_at', 'TEXT'], ['idempotency_key', 'TEXT']
  ]);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS documents_idem ON documents(idempotency_key) WHERE idempotency_key IS NOT NULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS org_encryption_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_version INTEGER NOT NULL,
    wrapped_dek TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    destroyed_at TEXT,
    UNIQUE(org_id, key_version)
  );`);
})();

// Stage 5: billing columns on organizations for pre-existing DBs.
(function migrateOrgBillingColumns() {
  const cols = db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name);
  for (const [name, ddl] of [
    ['plan_status', "TEXT NOT NULL DEFAULT 'active'"],
    ['plan_renews_at', 'TEXT'],
    ['stripe_customer_id', 'TEXT'],
    ['stripe_subscription_id', 'TEXT']
  ]) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE organizations ADD COLUMN ${name} ${ddl};`);
    }
  }
})();

// ---------- helpers ----------
export const nowIso = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const cuidish = () => 'c' + randomBytes(12).toString('hex');

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(pw, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function audit(action, detail = '', orgId = null, userId = null) {
  db.prepare('INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)')
    .run(uuid(), orgId, userId, nowIso(), action, detail);
}

// ---------- row mappers: snake_case DB -> camelCase API ----------
const j = (s, fb = []) => { try { return JSON.parse(s); } catch { return fb; } };

export const mapOrg = r => r && ({
  id: r.id, name: r.name, slug: r.slug, type: r.type, plan: r.plan,
  planStatus: r.plan_status || 'active', planRenewsAt: r.plan_renews_at,
  joinCode: r.join_code, reviewQueueEnabled: !!r.review_queue_enabled,
  createdAt: r.created_at
});
export const mapUser = r => r && ({
  id: r.id, email: r.email, name: r.name, locale: r.locale,
  deleteScheduledAt: r.delete_scheduled_at, createdAt: r.created_at
});
export const mapProvision = r => r && ({
  id: r.id, lawId: r.law_id, lawNameAr: r.law_name_ar, lawNameEn: r.law_name_en,
  articleNo: r.article_no, amendmentVersion: r.amendment_version,
  effectiveFrom: r.effective_from, effectiveTo: r.effective_to, gazetteRef: r.gazette_ref,
  titleAr: r.title_ar, titleEn: r.title_en, textAr: r.text_ar, textEn: r.text_en,
  summaryAr: r.summary_ar, summaryEn: r.summary_en, topics: j(r.topics),
  verified: !!r.verified, verificationNote: r.verification_note,
  verifiedBy: r.verified_by, verifiedAt: r.verified_at,
  version: r.version, supersedesId: r.supersedes_id, isActive: !!r.is_active,
  createdAt: r.created_at
});
export const mapCase = r => r && ({
  id: r.id, orgId: r.org_id, ownerId: r.owner_id, number: r.number, court: r.court,
  circuit: r.circuit, caseType: r.case_type, subType: r.sub_type, role: r.role,
  filedAt: r.filed_at, servedAt: r.served_at, opponent: r.opponent,
  opponentPleading: r.opponent_pleading, subjectName: r.subject_name,
  intakeChannel: r.intake_channel, createdAt: r.created_at, updatedAt: r.updated_at
});
export const mapEvent = r => r && ({
  id: r.id, caseId: r.case_id, date: r.date, title: r.title, type: r.type,
  note: r.note, appealFiled: !!r.appeal_filed, defect: !!r.defect, createdAt: r.created_at
});
export const mapDocument = r => r && ({
  id: r.id, caseId: r.case_id, name: r.name, hash: r.hash, size: r.size, mime: r.mime,
  hashedAt: r.hashed_at, metaRisk: r.meta_risk, notes: r.notes, version: r.version,
  previousId: r.previous_id, createdAt: r.created_at,
  // Phase A object-originals (null in hash-only mode)
  storageKey: r.storage_key ?? null, storageVersionId: r.storage_version_id ?? null,
  storageClass: r.storage_class ?? null, retentionUntil: r.retention_until ?? null,
  deletedAt: r.deleted_at ?? null, virusScanStatus: r.virus_scan_status ?? null,
  virusScanAt: r.virus_scan_at ?? null
});
export const mapDeadline = r => r && ({
  id: r.id, caseId: r.case_id, titleAr: r.title_ar, titleEn: r.title_en, dueAt: r.due_at,
  kind: r.kind, provisionRef: r.provision_ref, completed: !!r.completed,
  sourceEventId: r.source_event_id, createdAt: r.created_at
});
export const mapDraft = r => r && ({
  id: r.id, caseId: r.case_id, orgId: r.org_id, createdById: r.created_by_id,
  type: r.type, titleAr: r.title_ar, titleEn: r.title_en, payload: j(r.payload, {}),
  status: r.status, finalizedAt: r.finalized_at, releasedAt: r.released_at,
  exportedAt: r.exported_at, coolingOffHours: r.cooling_off_hours,
  reviewRequired: !!r.review_required, createdAt: r.created_at, updatedAt: r.updated_at
});
export const mapAck = r => r && ({
  id: r.id, userId: r.user_id, draftId: r.draft_id, kind: r.kind,
  bannerVersion: r.banner_version, textSnapshot: r.text_snapshot, acceptedAt: r.accepted_at
});
export const mapNotification = r => r && ({
  id: r.id, orgId: r.org_id, userId: r.user_id, type: r.type, dedupeKey: r.dedupe_key,
  titleAr: r.title_ar, titleEn: r.title_en, bodyAr: r.body_ar, bodyEn: r.body_en,
  caseId: r.case_id, refType: r.ref_type, refId: r.ref_id, urgency: r.urgency,
  readAt: r.read_at, createdAt: r.created_at
});
