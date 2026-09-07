// Phase A (A1.5 step 4): dump-restore migration between SQLite and Postgres.
// Idempotent (TRUNCATE + reload); bidirectional by parameter:
//   node scripts/pg/migrate-from-sqlite.mjs --to pg      (default: sqlite → pg)
//   node scripts/pg/migrate-from-sqlite.mjs --to sqlite  (rollback replay)
// Guardrails: row-count verification per table + sha256 spot-checks on
// documents.hash. Run as bb_migrator (owner) — DDL must exist first
// (scripts/pg/001..006).
//
// The 7-day deletion workflow mid-migration (§A1.5): users.delete_scheduled_at
// is carried like any row — a user scheduled on SQLite lands in Postgres with
// the same value and the reaper evaluates it wherever it lives. Freeze writes
// during the copy (maintenance window) and there is no state in which a
// deletion is lost or double-executed.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
const target = args.includes('--to') ? args[args.indexOf('--to') + 1] : 'pg';
const SQLITE_PATH = process.env.SQLITE_PATH || new URL('../../data/big-brother.db', import.meta.url).pathname;

// dependency order (§A1.5 step 4) — includes RAG corpus tables (007_rag.sql)
const TABLES = [
  'organizations', 'users', 'memberships', 'legal_provisions', 'cases',
  'case_events', 'documents', 'deadlines', 'pack_drafts', 'acknowledgments',
  'feedbacks', 'consents', 'audit_logs', 'billing_events', 'notifications',
  'org_encryption_keys',
  'rag_ingest_jobs', 'rag_chunks', 'provision_amendments', 'rag_query_log'
];

// columns shared by both dialects (seq is generated — never copied)
const COLUMNS = {
  organizations: ['id','name','slug','type','plan','plan_status','plan_renews_at','stripe_customer_id','stripe_subscription_id','join_code','review_queue_enabled','delete_scheduled_at','deleted_at','created_at','updated_at'],
  users: ['id','email','password_hash','name','locale','delete_scheduled_at','sessions_invalid_before','created_at','updated_at'],
  memberships: ['id','user_id','org_id','role'],
  legal_provisions: ['id','law_id','law_name_ar','law_name_en','article_no','amendment_version','effective_from','effective_to','gazette_ref','title_ar','title_en','text_ar','text_en','summary_ar','summary_en','topics','verified','verification_note','verified_by','verified_at','version','supersedes_id','is_active','created_at'],
  cases: ['id','org_id','owner_id','number','court','circuit','case_type','sub_type','role','filed_at','served_at','opponent','opponent_pleading','subject_name','intake_channel','created_at','updated_at'],
  case_events: ['id','case_id','date','title','type','note','appeal_filed','defect','created_at'],
  documents: ['id','case_id','name','hash','size','mime','hashed_at','meta_risk','notes','version','previous_id','created_at','storage_key','storage_version_id','storage_class','retention_until','deleted_at','virus_scan_status','virus_scan_at','idempotency_key'],
  deadlines: ['id','case_id','title_ar','title_en','due_at','kind','provision_ref','completed','source_event_id','created_at'],
  pack_drafts: ['id','case_id','org_id','created_by_id','type','title_ar','title_en','payload','status','finalized_at','released_at','exported_at','cooling_off_hours','review_required','created_at','updated_at'],
  acknowledgments: ['id','user_id','draft_id','kind','banner_version','text_snapshot','accepted_at'],
  feedbacks: ['id','user_id','case_id','target_type','target_id','value','created_at'],
  consents: ['id','user_id','case_id','scope','version','text_snapshot','accepted_at'],
  audit_logs: ['id','org_id','user_id','at','action','detail'],
  billing_events: ['id','org_id','at','kind','plan','detail','ref'],
  notifications: ['id','org_id','user_id','type','dedupe_key','title_ar','title_en','body_ar','body_en','case_id','ref_type','ref_id','urgency','read_at','created_at'],
  org_encryption_keys: ['id','org_id','key_version','wrapped_dek','state','created_at','destroyed_at'],
  rag_ingest_jobs: ['id','manifest_hash','issue_no','publish_date','source_type','source_path','source_sha256','status','attested','ocr_engine','stats','created_by','created_at','updated_at'],
  rag_chunks: ['id','provision_id','law_id','article_no','article_part','chapter_heading','amendment_version','effective_from','effective_to','gazette_issue','gazette_date','text_canonical','text_normalized','text_hash','embedding','ocr_engine','ocr_confidence','ingest_job_id','is_active','status','created_at'],
  provision_amendments: ['id','amending_law_id','amending_article','target_law_id','target_article','action','gazette_issue','gazette_date','new_provision_id','applied_at','detected_by','approved_by','ingest_job_id','created_at'],
  rag_query_log: ['id','org_id','query_hash','latency_ms','embed_mode','created_at']
};

const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

function pgClient() {
  const envUrl = process.env.DATABASE_URL_MIGRATOR || process.env.DATABASE_URL;
  if (!envUrl) throw new Error('DATABASE_URL (migrator role) required for --to pg');
  return new pg.Client({ connectionString: envUrl });
}

async function loadPg() {
  const client = pgClient();
  await client.connect();
  const counts = {};
  for (const t of TABLES) {
    await client.query(`TRUNCATE TABLE ${t} CASCADE`);
    const cols = COLUMNS[t];
    const rows = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all();
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const values = [];
      const params = [];
      batch.forEach((r, bi) => {
        values.push(`(${cols.map((_, ci) => `$${bi * cols.length + ci + 1}`).join(',')})`);
        cols.forEach(c => params.push(r[c] ?? null));
      });
      await client.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${values.join(',')}`, params);
    }
    const cnt = await client.query(`SELECT COUNT(*) AS n FROM ${t}`);
    counts[t] = { source: rows.length, target: Number(cnt.rows[0].n) };
    if (counts[t].source !== counts[t].target) {
      throw new Error(`count mismatch on ${t}: ${JSON.stringify(counts[t])}`);
    }
  }
  // sha256 spot-checks on documents.hash (§A1.5 step 5)
  const srcHashes = sqlite.prepare('SELECT id, hash FROM documents ORDER BY id').all();
  const dstHashes = await client.query('SELECT id, hash FROM documents ORDER BY id');
  const dstMap = new Map(dstHashes.rows.map(r => [r.id, r.hash]));
  for (const s of srcHashes) {
    if (dstMap.get(s.id) !== s.hash) throw new Error(`hash spot-check failed for document ${s.id}`);
  }
  await client.end();
  console.log('dump-restore complete (sqlite → pg):', JSON.stringify(counts, null, 1));
}

async function loadSqlite() {
  const envUrl = process.env.DATABASE_URL;
  if (!envUrl) throw new Error('DATABASE_URL required for --to sqlite');
  const client = new pg.Client({ connectionString: envUrl });
  await client.connect();
  const counts = {};
  for (const t of TABLES) {
    const cols = COLUMNS[t];
    sqlite.exec(`DELETE FROM ${t};`);
    const res = await client.query(`SELECT ${cols.join(', ')} FROM ${t}`);
    const stmt = sqlite.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const r of res.rows) stmt.run(...cols.map(c => r[c] ?? null));
    const n = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    counts[t] = { source: res.rowCount, target: Number(n) };
    if (counts[t].source !== counts[t].target) throw new Error(`count mismatch on ${t}: ${JSON.stringify(counts[t])}`);
  }
  await client.end();
  console.log('dump-restore complete (pg → sqlite):', JSON.stringify(counts, null, 1));
}

if (target === 'pg') await loadPg();
else if (target === 'sqlite') await loadSqlite();
else { console.error('unknown target:', target); process.exit(1); }
