// Task 14 — KEK rotation (production readiness, secrets hygiene).
//
// The dev master key (data/dev-master.key) was tracked in the PUBLIC repo, so
// it is compromised by design. This script rotates the KEK: every org DEK is
// unwrapped with the old KEK and re-wrapped with a fresh one. DEK material,
// key_versions, and field ciphertexts stay untouched, so decryption keeps
// working unchanged — only the wrapping layer changes identity.
//
// Usage: node scripts/rotate-kek.mjs [--apply]
//   default = dry run (no writes); --apply performs the rotation.

import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DB_PATH = 'data/big-brother.db';
const KEY_FILE = 'data/dev-master.key';
const BACKUP = '.backups/big-brother-pre-kek-rotation.db';

const oldKey = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
if (oldKey.length !== 32) throw new Error(`old KEK has ${oldKey.length} bytes, expected 32`);
const newKey = randomBytes(32);

const aadKek = (orgId, kv) => Buffer.from(`kek|org|${orgId}|kv${kv}`);
const aadField = (orgId, table, column, rowId) => Buffer.from(`org|${table}|${column}|${rowId}`);

function unwrap(wrapped, kek, orgId, kv) {
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(wrapped.length - 16);
  const ct = wrapped.subarray(12, wrapped.length - 16);
  const d = createDecipheriv('aes-256-gcm', kek, iv);
  d.setAAD(aadKek(orgId, kv));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function wrap(dek, kek, orgId, kv) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(aadKek(orgId, kv));
  const ct = Buffer.concat([c.update(dek), c.final(), c.getAuthTag()]);
  return Buffer.concat([iv, ct]);
}

const db = new DatabaseSync(DB_PATH);
const rows = db.prepare('SELECT id, org_id, key_version, state, wrapped_dek FROM org_encryption_keys').all();
console.log(`org_encryption_keys rows: ${rows.length} | mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

// Pass 1 — verify every row unwraps with the OLD KEK before touching anything.
const deks = new Map();
for (const r of rows) {
  const dek = unwrap(Buffer.from(r.wrapped_dek, 'base64'), oldKey, r.org_id, r.key_version);
  if (dek.length !== 32) throw new Error(`row ${r.id}: bad DEK length ${dek.length}`);
  deks.set(r.id, dek);
  console.log(`  ok unwrap: org=${r.org_id} kv=${r.key_version} state=${r.state}`);
}

// Pass 2 (apply) — re-wrap under the NEW KEK with identical org/kv binding.
if (APPLY) {
  mkdirSync('.backups', { recursive: true });
  copyFileSync(DB_PATH, BACKUP);
  console.log(`backup written: ${BACKUP}`);
  const upd = db.prepare('UPDATE org_encryption_keys SET wrapped_dek = ? WHERE id = ?');
  for (const r of rows) {
    const rewrapped = wrap(deks.get(r.id), newKey, r.org_id, r.key_version);
    upd.run(rewrapped.toString('base64'), r.id);
  }
  writeFileSync(KEY_FILE, newKey.toString('base64') + '\n', { mode: 0o600 });
  console.log(`new KEK written to ${KEY_FILE} (untracked)`);
}

// Pass 3 — roundtrip: decrypt a real encrypted field with the CURRENT setup.
const encRow = db.prepare(
  "SELECT id, org_id, opponent_pleading FROM cases WHERE opponent_pleading LIKE 'enc:v1:%' LIMIT 1"
).get();
if (encRow) {
  const [, , kvStr, payloadB64] = encRow.opponent_pleading.split(':');
  const kv = Number(kvStr);
  const wrappedB64 = db.prepare(
    'SELECT wrapped_dek FROM org_encryption_keys WHERE org_id = ? AND key_version = ?'
  ).get(encRow.org_id, kv).wrapped_dek;
  const dek = unwrap(Buffer.from(wrappedB64, 'base64'), APPLY ? newKey : oldKey, encRow.org_id, kv);
  const payload = Buffer.from(payloadB64, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ct = payload.subarray(12, payload.length - 16);
  const d = createDecipheriv('aes-256-gcm', dek, iv);
  d.setAAD(aadField(encRow.org_id, 'cases', 'opponent_pleading', encRow.id));
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  console.log(`roundtrip decrypt (cases.opponent_pleading, org=${encRow.org_id}, kv=${kv}): OK — ${plain.length} chars recovered`);
} else {
  console.log('no encrypted field rows found for roundtrip check');
}

if (!APPLY) console.log('dry run clean — re-run with --apply to rotate');
