// Task 14 — one-shot Postgres activation for Big Brother on Vercel.
//
// Vercel/Neon Postgres cannot be provisioned programmatically with a plain
// API token (marketplace billing consent is interactive). Once the user
// creates the database in the Vercel dashboard, THIS script does everything
// else:
//
//   1. applies scripts/pg/001..007 (schemas, roles, tables, indexes, RLS,
//      functions, grants, RAG)
//   2. dump-restores the SQLite corpus/data via scripts/pg/migrate-from-sqlite
//   3. flips the Vercel project env to STORAGE_BACKEND=pg (via API token)
//   4. redeploys production and smoke-checks /api/health
//
// Usage:
//   DATABASE_URL="postgres://..." DATABASE_URL_SYSTEM="postgres://..." \
//     VERCEL_TOKEN="vcp_..." node scripts/pg-provision-once.mjs
//
// DATABASE_URL       — connect as bb_migrator for setup (BYPASSRLS, owner).
//                      If the dashboard URL uses another role, wrap it: the
//                      001 file creates bb_migrator with PASSWORD NULL; run
//                      `ALTER ROLE bb_migrator PASSWORD '...'` once as admin
//                      and use that URL for both vars if unsure.
// DATABASE_URL_SYSTEM— bb_system URL for system-scoped ops (defaults to
//                      DATABASE_URL). Production should issue a dedicated one.
// VERCEL_TOKEN       — optional; skips env flip + redeploy when absent.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_SYSTEM = process.env.DATABASE_URL_SYSTEM || DATABASE_URL;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (create a Postgres store in the Vercel dashboard first)');
  process.exit(1);
}

const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

// 1 — apply SQL assets in dependency order
const files = [
  'scripts/pg/001_schemas_roles.sql',
  'scripts/pg/002_tables.sql',
  'scripts/pg/003_indexes.sql',
  'scripts/pg/004_rls_policies.sql',
  'scripts/pg/005_functions.sql',
  'scripts/pg/006_grants.sql',
  'scripts/pg/007_rag.sql'
];
for (const f of files) {
  const sql = readFileSync(f, 'utf8');
  process.stdout.write(`applying ${f} ... `);
  await admin.query(sql);
  console.log('ok');
}

// 2 — data migration (row-count verified inside migrate-from-sqlite)
console.log('migrating SQLite data -> Postgres ...');
execFileSync('node', ['scripts/pg/migrate-from-sqlite.mjs', '--to', 'pg'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL, DATABASE_URL_SYSTEM }
});
await admin.end();

// 3 — flip Vercel project env (needs a token with project env write)
if (VERCEL_TOKEN) {
  const res = await fetch('https://api.vercel.com/v10/projects/big-brother/env', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { key: 'STORAGE_BACKEND', value: 'pg', type: 'plain', target: ['production', 'preview', 'development'] },
      { key: 'DATABASE_URL', value: DATABASE_URL, type: 'encrypted', target: ['production', 'preview', 'development'] },
      { key: 'DATABASE_URL_SYSTEM', value: DATABASE_URL_SYSTEM, type: 'encrypted', target: ['production', 'preview', 'development'] }
    ])
  });
  const body = await res.json();
  if (body.error) {
    // already-existing vars need upsert by id — print guidance and stop before deploy
    console.error('env upsert failed:', JSON.stringify(body.error));
    console.error('update STORAGE_BACKEND / DATABASE_URL / DATABASE_URL_SYSTEM in the dashboard, then re-run with SKIP_DEPLOY=1');
    process.exit(1);
  }
  console.log('Vercel env set: STORAGE_BACKEND=pg (+ DATABASE_URL, DATABASE_URL_SYSTEM)');

  // 4 — redeploy production and smoke-check
  if (!process.env.SKIP_DEPLOY) {
    execFileSync('npx', ['-y', 'vercel@latest', 'deploy', '--prod', '--yes', '--token', VERCEL_TOKEN], { stdio: 'inherit' });
    const health = await fetch('https://big-brother-neon.vercel.app/api/health').then(r => r.json()).catch(e => ({ error: String(e) }));
    console.log('post-deploy health:', JSON.stringify(health));
  }
} else {
  console.log('VERCEL_TOKEN not set — set STORAGE_BACKEND=pg + DATABASE_URL envs manually, then redeploy.');
}
console.log('DONE — Big Brother is on persistent Postgres.');
