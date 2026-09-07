// RAG ingest CLI — manifest-driven, operator-attested (docs/RAG_SPEC.md §1.2,
// DELIVERABLES §7.5 runbook). Dual-backend like scripts/reaper.mjs:
//   node scripts/rag-ingest.mjs --manifest var/rag/inbox/<law-id>/manifest.json [--dry-run]
//   node scripts/rag-ingest.mjs --scan var/rag/inbox [--dry-run]
//   STORAGE_BACKEND=pg DATABASE_URL_SYSTEM=... (pg backend, same as reaper)
//
// The CLI reads the source file from disk relative to the manifest's own
// directory, verifies sha256 against the manifest, and hands everything to
// src/lib/rag/pipeline.mjs (shared with the API route — one pipeline, one
// blocklist). Exit codes: 0 ok/idempotent, 1 refused/blocked/rejected.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const manifestIdx = process.argv.indexOf('--manifest');
const scanIdx = process.argv.indexOf('--scan');

// ---------- backend plumbing (mirrors scripts/reaper.mjs / ingest-corpus.mjs) ----------
const BACKEND = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'sqlite';
let ctx;
let auditFn;
if (BACKEND === 'pg') {
  const { Client } = await import('pg');
  const toPg = (sql) => { // quote-aware ? -> $n
    let out = '', n = 0, inStr = false;
    for (const ch of sql) { if (ch === "'") inStr = !inStr; out += (ch === '?' && !inStr) ? `$${++n}` : ch; }
    return out;
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL });
  await client.connect();
  ctx = {
    dialect: 'pg',
    all: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
    run: async (sql, params = []) => { const r = await client.query(toPg(sql), params); return { changes: r.rowCount ?? 0 }; },
    exec: async (sql) => { await client.query(sql); }
  };
  auditFn = async (action, detail) => {
    await client.query(
      'INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES ($1,NULL,NULL,$2,$3,$4)',
      ['c' + globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24), new Date().toISOString(), action, detail]
    );
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(process.cwd(), 'data', 'big-brother.db'));
  ctx = {
    dialect: 'sqlite',
    all: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => { const r = db.prepare(sql).run(...params); return { changes: Number(r.changes ?? 0) }; },
    exec: (sql) => { db.exec(sql); }
  };
  auditFn = async (action, detail) => {
    db.prepare('INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)')
      .run('c' + globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24), null, null, new Date().toISOString(), action, detail);
  };
}

const { runIngest, validateManifest } = await import('../src/lib/rag/pipeline.mjs');
const { ensureRagSchema } = await import('../src/lib/rag/store.mjs');

await ensureRagSchema(ctx);

function findManifests(root) {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'manifest.json') out.push(p);
    }
  };
  walk(root);
  return out;
}

async function ingestOne(manifestPath) {
  const abs = resolve(manifestPath);
  if (!existsSync(abs)) { console.error(`✘ manifest not found: ${abs}`); return false; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(abs, 'utf8')); }
  catch (e) { console.error(`✘ invalid manifest JSON (${abs}): ${e.message}`); return false; }

  const pre = validateManifest(manifest);
  if (!pre.ok) { console.error(`✘ manifest invalid (${abs}):`); for (const e of pre.errors) console.error(`   - ${e}`); return false; }

  // source lives beside the manifest (sourcePath is relative to it and must
  // stay inside it — no escaping the inbox drop directory)
  const dir = dirname(abs);
  const srcAbs = resolve(dir, manifest.sourcePath);
  if (!srcAbs.startsWith(dir + sep) && srcAbs !== dir) {
    console.error(`✘ sourcePath escapes the drop directory: ${manifest.sourcePath}`); return false;
  }
  if (!existsSync(srcAbs)) { console.error(`✘ source file missing: ${srcAbs}`); return false; }
  const sourceText = readFileSync(srcAbs, 'utf8');

  const r = await runIngest(ctx, { manifest, sourceText, dryRun: DRY, operator: manifest.operator?.name || 'cli', audit: auditFn });

  if (!r.ok) {
    console.error(`✘ ${manifest.issueNo} [${(manifest.laws || []).map((l) => l.lawId).join(',')}]: ${r.stage}`);
    if (r.report?.reason) console.error(`   ${r.report.reason}`);
    if (r.blocked?.length) console.error(`   BLOCKED_POLICY: ${r.blocked.join(', ')} — this block must not be worked around`);
    if (r.errors?.length) r.errors.forEach((e) => console.error(`   - ${e}`));
    return false;
  }
  if (r.idempotent) {
    console.log(`= ${manifest.issueNo}: idempotent re-run (job ${r.stage}, no changes)`);
    return true;
  }
  const s = r.stats;
  console.log(`${DRY ? '[dry-run] ' : '✔ '}${manifest.issueNo} → ${s.laws?.[0]?.lawId}: ${s.laws?.[0]?.chunks} chunk(s) ` +
    `(anchors ${s.anchors}/${s.anchorSource}, parts ${s.parts}, linked ${s.laws?.[0]?.linked}, embedded ${s.laws?.[0]?.embedded}${s.provisionalSource ? ', PROVISIONAL (unattested mirror)' : ''})`);
  if (s.warnings?.length) s.warnings.forEach((w) => console.log(`   ⚠ ${w}`));
  return true;
}

let ok = true;
if (manifestIdx > -1) {
  ok = await ingestOne(process.argv[manifestIdx + 1]);
} else if (scanIdx > -1) {
  const root = resolve(process.argv[scanIdx + 1] || 'var/rag/inbox');
  const manifests = findManifests(root);
  if (!manifests.length) { console.error(`no manifest.json found under ${root}`); process.exit(1); }
  for (const m of manifests) ok = (await ingestOne(m)) && ok;
} else {
  console.error('usage: rag-ingest.mjs --manifest <path> [--dry-run] | --scan <dir> [--dry-run]');
  process.exit(1);
}
process.exit(ok ? 0 : 1);
