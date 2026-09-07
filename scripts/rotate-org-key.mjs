// Phase A (A2.3): standalone org DEK rotation — usable as an operations script
// and spawned by the e2e suite (PA-08). Mirrors src/lib/crypto.ts exactly:
//   1. create key version N+1 (fresh random DEK, wrapped under KEK with the
//      version-specific wrap AAD)
//   2. re-encrypt the org's encrypted fields (cases.opponent_pleading,
//      pack_drafts.payload) row-by-row with the new DEK
//   3. retire version N
// Read path tolerates both versions (the prefix names the keyVersion), so
// old rows decrypt during the whole migration.
// Usage: node scripts/rotate-org-key.mjs <orgId>

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const orgId = process.argv[2];
if (!orgId) { console.error('usage: node scripts/rotate-org-key.mjs <orgId>'); process.exit(1); }

const masterFile = process.env.KMS_DEV_MASTER_KEY_FILE || './data/dev-master.key';
if (!existsSync(masterFile)) { console.error('dev master key not found:', masterFile); process.exit(1); }
const KEK = Buffer.from(readFileSync(masterFile, 'utf8').trim(), 'base64');

const nowIso = () => new Date().toISOString();
const wrapAad = (kv) => Buffer.from(`kek|org|${orgId}|kv${kv}`);
const fieldAad = (table, col, rowId) => Buffer.from(`org|${table}|${col}|${rowId}`);

function gcmEncrypt(dek, aad, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final(), c.getAuthTag()]);
  return `enc:v1:PLACEHOLDER_KV:${Buffer.concat([iv, ct]).toString('base64')}`;
}
function gcmDecrypt(dek, aad, stored) {
  const [, , , payloadB64] = stored.split(':');
  const payload = Buffer.from(payloadB64, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ct = payload.subarray(12, payload.length - 16);
  const d = createDecipheriv('aes-256-gcm', dek, iv);
  d.setAAD(aad); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

const db = new DatabaseSync(join(process.cwd(), 'data', 'big-brother.db'));
const latest = db.prepare('SELECT key_version, wrapped_dek FROM org_encryption_keys WHERE org_id = ? ORDER BY key_version DESC LIMIT 1').get(orgId);
if (!latest) { console.error('no keys for org', orgId); process.exit(1); }
const oldKv = Number(latest.key_version);

// unwrap the current DEK (wrap AAD names its version)
{
  const payload = Buffer.from(latest.wrapped_dek, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ct = payload.subarray(12, payload.length - 16);
  const d = createDecipheriv('aes-256-gcm', KEK, iv);
  d.setAAD(wrapAad(oldKv)); d.setAuthTag(tag);
  var oldDek = Buffer.concat([d.update(ct), d.final()]);
}
// unwrap any earlier versions too (read path during re-encryption)
const dekFor = {};
dekFor[oldKv] = oldDek;
for (const row of db.prepare('SELECT key_version, wrapped_dek FROM org_encryption_keys WHERE org_id = ? AND key_version < ?').all(orgId, oldKv)) {
  const payload = Buffer.from(row.wrapped_dek, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ct = payload.subarray(12, payload.length - 16);
  const d = createDecipheriv('aes-256-gcm', KEK, iv);
  d.setAAD(wrapAad(Number(row.key_version))); d.setAuthTag(tag);
  dekFor[Number(row.key_version)] = Buffer.concat([d.update(ct), d.final()]);
}

// 1. new key version
const newKv = oldKv + 1;
const newDek = randomBytes(32);
{
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEK, iv);
  c.setAAD(wrapAad(newKv));
  const wrapped = Buffer.concat([iv, c.update(newDek), c.final(), c.getAuthTag()]);
  db.prepare("INSERT INTO org_encryption_keys (id, org_id, key_version, wrapped_dek, state, created_at) VALUES (?,?,?,?, 'active', ?)")
    .run(`oek-${orgId}-${newKv}`, orgId, newKv, wrapped.toString('base64'), nowIso());
}

// 2. re-encrypt fields
let reencrypted = 0;
const cases = db.prepare('SELECT id, opponent_pleading FROM cases WHERE org_id = ?').all(orgId);
for (const row of cases) {
  const v = String(row.opponent_pleading || '');
  if (!v.startsWith('enc:v1:')) continue;
  const kv = Number(v.split(':')[2]);
  const plain = gcmDecrypt(dekFor[kv], fieldAad('cases', 'opponent_pleading', row.id), v);
  const cipher = gcmEncrypt(newDek, fieldAad('cases', 'opponent_pleading', row.id), plain)
    .replace('PLACEHOLDER_KV', String(newKv));
  db.prepare('UPDATE cases SET opponent_pleading = ? WHERE id = ?').run(cipher, row.id);
  reencrypted++;
}
const drafts = db.prepare('SELECT id, payload FROM pack_drafts WHERE org_id = ?').all(orgId);
for (const row of drafts) {
  const v = String(row.payload || '');
  if (!v.startsWith('enc:v1:')) continue;
  const kv = Number(v.split(':')[2]);
  const plain = gcmDecrypt(dekFor[kv], fieldAad('pack_drafts', 'payload', row.id), v);
  const cipher = gcmEncrypt(newDek, fieldAad('pack_drafts', 'payload', row.id), plain)
    .replace('PLACEHOLDER_KV', String(newKv));
  db.prepare('UPDATE pack_drafts SET payload = ? WHERE id = ?').run(cipher, row.id);
  reencrypted++;
}

// 3. retire the old version
db.prepare("UPDATE org_encryption_keys SET state = 'retired' WHERE org_id = ? AND key_version = ? AND state = 'active'").run(orgId, oldKv);

console.log(`rotated org ${orgId}: v${oldKv} -> v${newKv}, reencrypted=${reencrypted}`);
