// Phase A sandbox verification: boots an embedded Postgres (no root/docker
// needed), applies scripts/pg/*.sql, and reports connection strings.
// Usage: node scripts/pg/setup-embedded.mjs [--with-data]
//   --with-data  also dump-restores the current SQLite data (A1.5 step 4)
// The cluster keeps running in the background (var/pgdata) for e2e runs.

import Postgres from 'embedded-postgres';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.PG_PORT || 5433);
const PASSWORD = 'bb_dev_password';
const WITH_DATA = process.argv.includes('--with-data');

const pg = new Postgres({
  database: 'postgres',
  user: 'postgres',
  password: 'root',
  port: PORT,
  persistent: true
});

const sqlFile = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

async function main() {
  if (!existsSync('data/db/PG_VERSION')) {
    console.log('embedded pg: initialising cluster at data/db');
    await pg.initialise();
  }
  // start() is idempotent-enough: if the port already answers, skip
  const alreadyUp = await (async () => {
    try {
      const { Client } = await import('pg');
      const c = new Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'root', database: 'postgres' });
      await c.connect(); await c.end();
      return true;
    } catch { return false; }
  })();
  if (!alreadyUp) {
    await pg.start();
    console.log(`embedded pg: running on localhost:${PORT}`);
  } else {
    console.log(`embedded pg: cluster already running on localhost:${PORT}`);
  }

  const adminCred = { host: 'localhost', port: PORT, user: 'postgres', password: 'root', database: 'postgres' };

  const connect = async (database) => {
    const { Client } = await import('pg');
    const c = new Client({ ...adminCred, database });
    await c.connect();
    return c;
  };

  // 001: roles (idempotent DO block)
  const admin = await connect('postgres');
  await admin.query(sqlFile('./001_schemas_roles.sql').replace(/\\connect bigbrother[\s\S]*$/, ''));
  for (const role of ['bb_migrator', 'bb_app', 'bb_system']) {
    await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${PASSWORD}'`);
  }
  // database (CREATE DATABASE cannot run in a transaction/DO block)
  const dbExists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'bigbrother'`);
  if (!dbExists.rowCount) {
    await admin.query('CREATE DATABASE bigbrother OWNER bb_migrator');
    console.log('embedded pg: database bigbrother created');
  }
  await admin.end();

  const mig = await connect('bigbrother'); // owner/superuser connection
  for (const f of ['./002_tables.sql', './003_indexes.sql', './005_functions.sql']) {
    await mig.query(sqlFile(f));
  }
  // 004: RLS policies
  const policies = sqlFile('./004_rls_policies.sql');
  await mig.query(policies);
  await mig.query(sqlFile('./006_grants.sql'));
  // 007: RAG Phase 1 additive corpus tables + grants (docs/RAG_SPEC.md §4.1)
  await mig.query(sqlFile('./007_rag.sql'));
  // grant login passwords usage on the db
  await mig.query(`GRANT CONNECT ON DATABASE bigbrother TO bb_app, bb_system`);
  await mig.end();
  console.log('embedded pg: DDL + RLS policies applied (002/003/004/005/006/007)');

  if (WITH_DATA) {
    console.log('embedded pg: migrating SQLite data (dump-restore)…');
    execFileSync(process.execPath, ['scripts/pg/migrate-from-sqlite.mjs', '--to', 'pg'], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL_MIGRATOR: `postgresql://postgres:root@localhost:${PORT}/bigbrother` }
    });
  }

  console.log('\nconnection strings for the app:');
  console.log(`  STORAGE_BACKEND=pg`);
  console.log(`  DATABASE_URL=postgresql://bb_app:${PASSWORD}@localhost:${PORT}/bigbrother`);
  console.log(`  DATABASE_URL_SYSTEM=postgresql://bb_system:${PASSWORD}@localhost:${PORT}/bigbrother`);
}

main().catch(err => { console.error('setup failed:', err); process.exit(1); });
