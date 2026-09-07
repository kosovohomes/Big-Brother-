// Neon preflight for the Big Brother Postgres cutover.
// Verifies, WITHOUT mutating anything:
//   1. pooled + unpooled connectivity, server version
//   2. neondb_owner role attributes (CREATEROLE / BYPASSRLS / superuser)
//   3. required extensions available (pgcrypto for gen_random_bytes)
//   4. session-level GUC retention (set_config(..., false)) under backend
//      churn — the pg driver holds a dedicated client per request and sets
//      session GUCs; on a transaction-mode pooler those can drift to another
//      backend, which would break RLS scoping (fail-closed) or leak scope.
//
// Usage: NEON_POOLED_URL=... NEON_UNPOOLED_URL=... node scripts/pg-neon-preflight.mjs
import pg from 'pg';

const POOLED = process.env.NEON_POOLED_URL;
const UNPOOLED = process.env.NEON_UNPOOLED_URL || (POOLED ? POOLED.replace('-pooler', '') : undefined);
if (!POOLED || !UNPOOLED) {
  console.error('NEON_POOLED_URL and NEON_UNPOOLED_URL required');
  process.exit(1);
}

const rounds = Number(process.env.PREFLIGHT_ROUNDS || 15);
const report = { pooled: {}, unpooled: {} };

async function probe(url, label) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  await client.connect();
  const v = await client.query('SELECT version() AS v, current_user AS u, current_database() AS d');
  const attrs = await client.query(
    `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin
     FROM pg_roles WHERE rolname = current_user`);
  const ext = await client.query(
    `SELECT name, default_version, installed_version IS NOT NULL AS installed
     FROM pg_available_extensions WHERE name IN ('pgcrypto','vector','pg_trgm')`);
  console.log(`[${label}]`, v.rows[0].v.split(',')[0], '| user:', v.rows[0].u, '| db:', v.rows[0].d);
  console.log(`[${label}] attrs:`, JSON.stringify(attrs.rows[0]));
  console.log(`[${label}] extensions:`, JSON.stringify(ext.rows));

  // session GUC retention under churn: hold ONE client, set a session GUC,
  // then hammer other connections (forcing PgBouncer backend reassignment),
  // then read the GUC back on the held client.
  const churn = [];
  for (let i = 0; i < 6; i++) {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    churn.push(c);
  }
  let mismatches = 0;
  const samples = [];
  for (let r = 0; r < rounds; r++) {
    const expect = `r${r}-${label}`;
    await client.query(`SELECT set_config('app.org_id', $1, false)`, [expect]);
    // churn: each autocommit statement may land on a different backend
    for (const c of churn) await c.query('SELECT count(*) FROM pg_roles');
    const got = await client.query(`SELECT current_setting('app.org_id', true) AS v`);
    const okVal = got.rows[0].v === expect;
    if (!okVal) { mismatches++; samples.push({ expect, got: got.rows[0].v }); }
    await new Promise(res => setTimeout(res, 50));
  }
  for (const c of churn) await c.end().catch(() => {});
  console.log(`[${label}] session-GUC retention: ${rounds - mismatches}/${rounds} held` +
    (samples.length ? ` | drift samples: ${JSON.stringify(samples.slice(0, 3))}` : ''));
  await client.end();
  return { version: v.rows[0].v.split(',')[0], user: v.rows[0].u, attrs: attrs.rows[0], ext: ext.rows, gucHeld: rounds - mismatches, gucRounds: rounds };
}

report.pooled = await probe(POOLED, 'pooled');
report.unpooled = await probe(UNPOOLED, 'unpooled');
console.log('PREFLIGHT-RESULT', JSON.stringify(report));
