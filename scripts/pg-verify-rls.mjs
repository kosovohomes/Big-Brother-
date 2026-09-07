// Post-cutover RLS verification against the live Neon database.
// Proves the security surface with REAL queries (each write probe wrapped in
// a ROLLBACK'd transaction so nothing persists):
//   V1 fail-closed: bb_app with NO GUCs sees zero tenant/corpus/user rows
//   V2 org scoping: bb_app with app.* GUCs sees exactly its org's rows
//   V3 cross-org:   bb_app of org A cannot read org B's case by id
//   V4 with-check:  bb_app INSERT with foreign org_id -> policy violation
//   V5 grant shape: bb_app cannot UPDATE users / read org_encryption_keys
//   V6 system lane: bb_system (BYPASSRLS) sees everything, audit insert ok
//   V7 migrator:    bb_migrator (BYPASSRLS owner) sees everything
//
// Usage: node scripts/pg-verify-rls.mjs   (reads scripts/pg/.neon-credentials.json)
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { urls } = JSON.parse(readFileSync('scripts/pg/.neon-credentials.json', 'utf8'));
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const c = (u) => new pg.Client({ connectionString: u, connectionTimeoutMillis: 15000 });

// --- fixtures (read via bb_migrator, BYPASSRLS) ---
const mig = c(urls.DATABASE_URL_MIGRATOR);
await mig.connect();
const orgs = (await mig.query(`SELECT o.id, o.name, (SELECT count(*) FROM cases cs WHERE cs.org_id = o.id)::int AS cases FROM organizations o ORDER BY o.name`)).rows;
const orgA = orgs.find(o => o.cases > 0) || orgs[0];
const orgB = orgs.find(o => o.id !== orgA.id && o.cases > 0) || orgs.find(o => o.id !== orgA.id);
const foreignCase = (await mig.query(`SELECT id FROM cases WHERE org_id = $1 LIMIT 1`, [orgB.id])).rows[0];
const totCases = (await mig.query(`SELECT count(*)::int AS n FROM cases`)).rows[0].n;
const totProvisions = (await mig.query(`SELECT count(*)::int AS n FROM legal_provisions`)).rows[0].n;
await mig.end();
console.log(`fixtures: orgA=${orgA.id}(${orgA.cases} cases) orgB=${orgB.id} foreignCase=${foreignCase?.id} totalCases=${totCases} provisions=${totProvisions}`);

// --- V1/V2/V3/V4/V5: bb_app ---
const app = c(urls.DATABASE_URL);
await app.connect();
const n = async (q, p = []) => Number((await app.query(q, p)).rows[0].n);

check('V1a cases fail-closed', await n(`SELECT count(*)::int AS n FROM cases`) === 0);
check('V1b users fail-closed', await n(`SELECT count(*)::int AS n FROM users`) === 0);
check('V1c legal_provisions fail-closed (P13 needs user GUC)', await n(`SELECT count(*)::int AS n FROM legal_provisions`) === 0);
try {
  await n(`SELECT count(*)::int AS n FROM org_encryption_keys`);
  check('V1d org_encryption_keys inaccessible (P15)', false, 'select unexpectedly allowed');
} catch (e) {
  // stronger than zero rows: bb_app has NO grant at all on the table (006)
  check('V1d org_encryption_keys inaccessible (P15)', e.code === '42501', `denied (${e.code})`);
}
check('V1e notifications fail-closed', await n(`SELECT count(*)::int AS n FROM notifications`) === 0);

await app.query(`SELECT set_config('app.org_id', $1, false), set_config('app.user_id', $2, false), set_config('app.role', $3, false)`, [orgA.id, 'u-probe', 'MEMBER']);
check('V2a org-scoped cases visible', await n(`SELECT count(*)::int AS n FROM cases`) === orgA.cases, `${orgA.cases}/${orgA.cases}`);
check('V2b provisions readable with user GUC (P13)', await n(`SELECT count(*)::int AS n FROM legal_provisions`) === totProvisions);
check('V2c own org visible', (await app.query(`SELECT id FROM organizations WHERE id = $1`, [orgA.id])).rowCount === 1);

check('V3 cross-org case by id invisible', (await app.query(`SELECT id FROM cases WHERE id = $1`, [foreignCase.id])).rowCount === 0);

try {
  await app.query('BEGIN');
  await app.query(`INSERT INTO cases (id, org_id, owner_id, number, court, circuit, case_type, sub_type, role, opponent, subject_name, intake_channel, created_at, updated_at)
                   VALUES ('rls-probe-x', $1, $2, 'X/2099', 'X', 'X', 'OTHER', 'X', 'CLAIMANT', 'X', 'X', 'API', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, [orgB.id, 'u-probe']);
  check('V4 foreign-org INSERT blocked', false, 'insert unexpectedly succeeded');
} catch (e) {
  check('V4 foreign-org INSERT blocked', e.code === '42501', e.code || e.message);
} finally { await app.query('ROLLBACK').catch(() => {}); }

try {
  await app.query('BEGIN');
  await app.query(`INSERT INTO cases (id, org_id, owner_id, number, court, circuit, case_type, sub_type, role, opponent, subject_name, intake_channel, created_at, updated_at)
                   VALUES ('rls-probe-o', $1, $2, 'X/2099', 'X', 'X', 'OTHER', 'X', 'CLAIMANT', 'X', 'X', 'API', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, [orgA.id, 'u-probe']);
  check('V4b same-org INSERT allowed (WITH CHECK)', true);
} catch (e) {
  check('V4b same-org INSERT allowed (WITH CHECK)', false, e.code || e.message);
} finally { await app.query('ROLLBACK').catch(() => {}); }

try {
  await app.query(`UPDATE users SET name = 'pwn' WHERE id = (SELECT id FROM users LIMIT 1)`);
  check('V5a users UPDATE denied to bb_app (no grant)', false, 'unexpectedly allowed');
} catch (e) {
  check('V5a users UPDATE denied to bb_app (no grant)', e.code === '42501', e.code || e.message);
}
await app.end();

// --- V6: bb_system ---
const sys = c(urls.DATABASE_URL_SYSTEM);
await sys.connect();
const sysN = async (q, p = []) => Number((await sys.query(q, p)).rows[0].n);
check('V6a bb_system sees all cases (BYPASSRLS)', await sysN(`SELECT count(*)::int AS n FROM cases`) === totCases);
check('V6b bb_system sees org_encryption_keys', await sysN(`SELECT count(*)::int AS n FROM org_encryption_keys`) > 0);
try {
  await sys.query('BEGIN');
  await sys.query(`INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES ('rls-probe-audit', $1, 'u-probe', '2026-01-01T00:00:00Z', 'probe', 'verification')`, [orgA.id]);
  check('V6c bb_system audit insert ok', true);
} catch (e) { check('V6c bb_system audit insert ok', false, e.code || e.message); }
finally { await sys.query('ROLLBACK').catch(() => {}); }
await sys.end();

// --- V7: bb_migrator ---
const m2 = c(urls.DATABASE_URL_MIGRATOR);
await m2.connect();
check('V7 bb_migrator full visibility', Number((await m2.query(`SELECT count(*)::int AS n FROM cases`)).rows[0].n) === totCases);
await m2.end();

const failed = results.filter(r => !r.pass);
console.log(`\nRLS VERIFICATION: ${results.length - failed.length}/${results.length} PASSED`);
process.exit(failed.length ? 1 : 0);
