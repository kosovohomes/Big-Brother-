// Phase A (PA-01): dual-backend e2e runner — asserts two ALL CHECKS PASSED
// logs, one per STORAGE_BACKEND. Usage:
//   node scripts/run-e2e-both.mjs                 # sqlite run + pg run (pg up)
//   BACKENDS=sqlite node scripts/run-e2e-both.mjs # sqlite only (sandbox CI)
// The pg run requires a provisioned Postgres (scripts/pg/001..006 applied and
// seeded via migrate-from-sqlite) and the server started with STORAGE_BACKEND=pg.
// This runner does NOT boot servers itself; it drives the suite against
// BASE (default http://localhost:3000) once per backend listed in BACKENDS,
// comparing the server-reported backend (via /api/health) each time.

import { spawnSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:3000';
const backends = (process.env.BACKENDS || 'sqlite,pg').split(',').map(s => s.trim());

async function currentBackend() {
  const r = await fetch(`${BASE}/api/health`);
  const j = await r.json();
  return j.db === 'postgres' ? 'pg' : 'sqlite';
}

const results = [];
for (const expected of backends) {
  const actual = await currentBackend();
  if (actual !== expected) {
    console.error(`runner: server is on ${actual}, expected ${expected} — restart the server with STORAGE_BACKEND=${expected} (and DATABASE_URL for pg)`);
    results.push({ expected, ok: false, reason: 'backend mismatch' });
    continue;
  }
  console.log(`\n════ e2e against STORAGE_BACKEND=${expected} ════`);
  const out = spawnSync(process.execPath, ['scripts/e2e.mjs'], { encoding: 'utf8', env: { ...process.env, BASE } });
  const passed = out.stdout.includes('ALL CHECKS PASSED') && out.status === 0;
  console.log(out.stdout.split('\n').filter(l => l.includes('FAILED') || l.includes('PASSED') || l.includes('✘')).join('\n') || out.stdout.slice(-500));
  results.push({ expected, ok: passed, reason: passed ? '' : 'suite failures' });
}

const green = results.filter(r => r.ok).length;
console.log(`\nrun-e2e-both: ${green}/${results.length} backend(s) fully green`);
console.log(results.map(r => `  ${r.expected}: ${r.ok ? 'ALL CHECKS PASSED' : 'FAILED' + ' — ' + (r.reason || '')}`).join('\n'));
process.exit(green === results.length ? 0 : 1);
