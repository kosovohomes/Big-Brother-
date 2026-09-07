// Neon-specific one-shot provisioning for Big Brother Postgres.
// Complements scripts/pg-provision-once.mjs (docker path) with the Neon
// realities found by pg-neon-preflight.mjs:
//   - connect admin is neondb_owner (CREATEROLE, BYPASSRLS, owns neondb)
//   - bb_* roles must be created WITH passwords (Neon has no local trust auth)
//   - public schema objects should END UP OWNED BY bb_migrator (BYPASSRLS
//     owner, per PHASE_A_SPEC A2.1) — achieved via GRANT + SET ROLE so
//     002..007 run as bb_migrator directly
//   - pgcrypto must exist before 005 (gen_random_bytes)
//
// Usage:
//   NEON_ADMIN_URL="postgresql://neondb_owner:...@ep-.../neondb?sslmode=require" \
//   BB_APP_PW=... BB_SYSTEM_PW=... BB_MIGRATOR_PW=... \
//     node scripts/pg-provision-neon.mjs
//
// Idempotent: safe to re-run (IF NOT EXISTS / DO blocks). Never logs secrets;
// prints only masked URLs. Credentials are the caller's responsibility
// (keep them in gitignored files).

import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const ADMIN_URL = process.env.NEON_ADMIN_URL;
if (!ADMIN_URL) {
  console.error('NEON_ADMIN_URL required');
  process.exit(1);
}
const mask = (u) => u.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');

// unpooled variant of any Neon URL (drop -pooler from the host)
const unpooled = (u) => u.replace('-pooler', '');
// strip params we manage explicitly, keep sslmode
const clean = (u) => {
  const url = new URL(u);
  const keep = ['sslmode', 'channel_binding'];
  const params = keep.filter(k => url.searchParams.has(k)).map(k => `${k}=${url.searchParams.get(k)}`).join('&');
  return `${url.origin}${url.pathname}${params ? '?' + params : ''}`;
};

const pw = {
  app: process.env.BB_APP_PW || randomBytes(24).toString('hex'),
  system: process.env.BB_SYSTEM_PW || randomBytes(24).toString('hex'),
  migrator: process.env.BB_MIGRATOR_PW || randomBytes(24).toString('hex')
};

const host = new URL(ADMIN_URL).hostname;
const db = new URL(ADMIN_URL).pathname.replace(/^\//, '') || 'neondb';
const mkUrl = (role, pass, pooledOk) => {
  const h = pooledOk ? host : unpooled(host);
  return `postgresql://${role}:${encodeURIComponent(pass)}@${h}/${db}?sslmode=require`;
};

const urls = {
  app_unpooled: mkUrl('bb_app', pw.app, false),
  system_unpooled: mkUrl('bb_system', pw.system, false),
  migrator_unpooled: mkUrl('bb_migrator', pw.migrator, false)
};

const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 15000 });
await admin.connect();

// 0 — extension prerequisite for 005_functions.sql (gen_random_bytes)
process.stdout.write('CREATE EXTENSION pgcrypto ... ');
await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
console.log('ok');

// 1 — 001 roles (PASSWORD NULL block is idempotent), then set passwords
for (const f of ['scripts/pg/001_schemas_roles.sql']) {
  process.stdout.write(`applying ${f} ... `);
  await admin.query(readFileSync(f, 'utf8'));
  console.log('ok');
}
for (const [role, p] of [['bb_app', pw.app], ['bb_system', pw.system], ['bb_migrator', pw.migrator]]) {
  process.stdout.write(`ALTER ROLE ${role} PASSWORD ... `);
  await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${p.replace(/'/g, "''")}'`);
  console.log('ok');
}

// 2 — let the admin SET ROLE into bb_migrator, then create everything else
// as bb_migrator so tables/functions/indexes are owned by the BYPASSRLS role
process.stdout.write('GRANT bb_migrator TO admin ... ');
await admin.query("DO $$ DECLARE u text := current_user; BEGIN EXECUTE format('GRANT bb_migrator TO %I', u); END $$;");
console.log('ok');
await admin.query('SET ROLE bb_migrator');

const files = [
  'scripts/pg/002_tables.sql',
  'scripts/pg/003_indexes.sql',
  'scripts/pg/004_rls_policies.sql',
  'scripts/pg/005_functions.sql',
  'scripts/pg/006_grants.sql',
  'scripts/pg/007_rag.sql'
];
for (const f of files) {
  process.stdout.write(`applying ${f} (as bb_migrator) ... `);
  await admin.query(readFileSync(f, 'utf8'));
  console.log('ok');
}
await admin.query('RESET ROLE');

// 3 — ownership audit: every bb table/function must be owned by bb_migrator
const own = await admin.query(`
  SELECT 'table' AS kind, tablename AS name, tableowner AS owner FROM pg_tables
   WHERE schemaname = 'public' AND tablename LIKE 'bb_%' OR (schemaname='public' AND tablename IN
    ('organizations','users','memberships','legal_provisions','cases','case_events','documents',
     'deadlines','pack_drafts','acknowledgments','feedbacks','consents','audit_logs','billing_events',
     'notifications','org_encryption_keys','rag_ingest_jobs','rag_chunks','provision_amendments','rag_query_log'))
  UNION ALL
  SELECT 'function', proname, pg_get_userbyid(proowner) FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname IN ('app_execute_delete','app_notify')`);
const wrongOwner = own.rows.filter(r => r.owner !== 'bb_migrator');
if (wrongOwner.length) {
  console.error('ownership drift:', JSON.stringify(wrongOwner));
  process.exit(1);
}
console.log(`ownership: ${own.rows.length} objects owned by bb_migrator`);

// 4 — table inventory + RLS status
const inv = await admin.query(`
  SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname`);
console.log('tables:', inv.rows.map(r => `${r.relname}(rls:${r.rls ? 1 : 0}${r.force_rls ? 'F' : ''})`).join(' '));

await admin.end();

// 5 — smoke the three role URLs (auth + basic privilege shape)
for (const [label, url] of Object.entries(urls)) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  await c.connect();
  const who = await c.query('SELECT current_user AS u, session_user AS s');
  console.log(`role smoke ${label}: ${who.rows[0].u}/${who.rows[0].s} ${mask(url)}`);
  await c.end();
}

// 6 — persist credentials for the follow-on steps (gitignored)
const out = {
  generatedAt: new Date().toISOString(),
  host, database: db,
  urls: {
    DATABASE_URL: urls.app_unpooled,
    DATABASE_URL_SYSTEM: urls.system_unpooled,
    DATABASE_URL_MIGRATOR: urls.migrator_unpooled,
    NEON_ADMIN_UNPOOLED: clean(unpooled(ADMIN_URL)),
    NEON_ADMIN_POOLED: clean(ADMIN_URL)
  }
};
writeFileSync('scripts/pg/.neon-credentials.json', JSON.stringify(out, null, 2));
console.log('credentials written to scripts/pg/.neon-credentials.json (gitignored)');
console.log('PROVISION-OK');
