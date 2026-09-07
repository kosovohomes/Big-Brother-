// Phase A (A2.3): per-tenant envelope encryption.
//
//   KEK (KMS master key, never leaves the provider)
//     └─ wraps per-org DEK (AES-256) → org_encryption_keys.wrapped_dek
//          └─ encrypts fields per row: AES-256-GCM
//
// Ciphertext scheme (self-describing, backward-compatible — no schema flag):
//   enc:v1:<keyVersion>:<base64(iv(12) || ciphertext || gcm-tag)>
// Readers split on ':'; values without the prefix are legacy plaintext
// (decrypt-on-read fallback = e2e PA-07), which is what makes the
// ENCRYPTION_ENABLED flag safe and reversible on existing rows.
//
// AAD tenant binding: every GCM call binds `org|table|column|rowId`, so a
// ciphertext copied into another org's row (or another column) FAILS to
// decrypt — cross-tenant ciphertext-swap is defeated at the crypto layer.
//
// KMS providers: dev (file-backed master key, sandbox default — the 98
// checks stay green), vault/aws (production; wired via env, not in sandbox).

import { createCipheriv, createDecipheriv, randomBytes, randomFillSync, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { flags } from './config';
import { getDriver, withSystemCtx } from './storage';

interface OrgDek { dek: Buffer; keyVersion: number }
const dekCache = new Map<string, OrgDek>();

// ---------- KMS: KEK access ----------

function devMasterKey(): Buffer {
  // 1. Explicit env value (serverless/Vercel: read-only FS — no writable key
  //    file; value injected as an encrypted env var, never committed).
  const envB64 = process.env.KMS_DEV_MASTER_KEY_B64;
  if (envB64) return Buffer.from(envB64, 'base64');
  // 2. File-backed (sandbox/self-hosted default; gitignored since Task 14 —
  //    the file must never ship in the public repo again).
  const file = flags.kmsDevMasterKeyFile();
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  // 3. First-boot generation (dev only). On read-only deployments writeFileSync
  //    throws EROFS — fail-closed rather than silently inventing a key.
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return key;
}

function kek(): Buffer {
  switch (flags.kmsProvider()) {
    case 'dev': return devMasterKey();
    default: throw new Error(`KMS_PROVIDER=${flags.kmsProvider()} requires provider wiring (prod only; see PHASE_A_SPEC A2.3)`);
  }
}

// ---------- org DEK lifecycle ----------

export async function getOrCreateOrgDek(orgId: string): Promise<OrgDek> {
  const cached = dekCache.get(orgId);
  if (cached) return cached;
  const d = await getDriver();
  return withSystemCtx(async () => {
    const row = await d.prepare(
      "SELECT key_version, wrapped_dek FROM org_encryption_keys WHERE org_id = ? AND state = 'active' ORDER BY key_version DESC LIMIT 1"
    ).get(orgId) as { key_version: number; wrapped_dek: string } | undefined;
    if (row) {
      const unwrapped = unwrapDek(Buffer.from(row.wrapped_dek, 'base64'), orgId, Number(row.key_version));
      const entry = { dek: unwrapped, keyVersion: Number(row.key_version) };
      dekCache.set(orgId, entry);
      return entry;
    }
    const dek = randomBytes(32);
    const wrapped = wrapDek(dek, orgId, 1);
    await d.prepare(
      'INSERT INTO org_encryption_keys (id, org_id, key_version, wrapped_dek, state, created_at) VALUES (?,?,?,?,?,?)'
    ).run(`oek-${orgId}-1`, orgId, 1, wrapped.toString('base64'), 'active', new Date().toISOString());
    const entry = { dek, keyVersion: 1 };
    dekCache.set(orgId, entry);
    return entry;
  });
}

/** Load a specific key version (read path for old-version rows). */
async function getOrgDekVersion(orgId: string, keyVersion: number): Promise<OrgDek> {
  const current = dekCache.get(orgId);
  if (current && current.keyVersion === keyVersion) return current;
  const d = await getDriver();
  return withSystemCtx(async () => {
    const row = await d.prepare(
      'SELECT wrapped_dek, state FROM org_encryption_keys WHERE org_id = ? AND key_version = ?'
    ).get(orgId, keyVersion) as { wrapped_dek: string; state: string } | undefined;
    if (!row) throw new Error(`org DEK v${keyVersion} not found`);
    if (row.state === 'destroyed') throw new Error(`org DEK v${keyVersion} destroyed (crypto-shredded)`);
    const entry = { dek: unwrapDek(Buffer.from(row.wrapped_dek, 'base64'), orgId, keyVersion), keyVersion };
    if (!dekCache.has(orgId)) dekCache.set(orgId, entry);
    return entry;
  });
}

function wrapDek(dek: Buffer, orgId: string, keyVersion: number): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  cipher.setAAD(Buffer.from(`kek|org|${orgId}|kv${keyVersion}`));
  const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([iv, ct]);
}

function unwrapDek(wrapped: Buffer, orgId: string, keyVersion: number): Buffer {
  const iv = wrapped.subarray(0, 12);
  const tag = wrapped.subarray(wrapped.length - 16);
  const ct = wrapped.subarray(12, wrapped.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', kek(), iv);
  decipher.setAAD(Buffer.from(`kek|org|${orgId}|kv${keyVersion}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ---------- field-level crypto ----------

function aadFor(orgId: string, table: string, column: string, rowId: string): Buffer {
  return Buffer.from(`org|${table}|${column}|${rowId}`);
}

export async function encryptField(orgId: string, table: string, column: string, rowId: string, plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  if (!flags.encryptionEnabled()) return plaintext;
  const { dek, keyVersion } = await getOrCreateOrgDek(orgId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(aadFor(orgId, table, column, rowId));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final(), cipher.getAuthTag()]);
  return `enc:v1:${keyVersion}:${Buffer.concat([iv, ct]).toString('base64')}`;
}

export async function decryptField(orgId: string, table: string, column: string, rowId: string, stored: string | null | undefined): Promise<string> {
  const value = stored ?? '';
  if (!value.startsWith('enc:v1:')) return value; // legacy plaintext (PA-07)
  const [, , kvStr, payloadB64] = value.split(':');
  const keyVersion = Number(kvStr);
  const { dek } = await getOrgDekVersion(orgId, keyVersion);
  const payload = Buffer.from(payloadB64, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const ct = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(aadFor(orgId, table, column, rowId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ---------- rotation & crypto-shredding ----------

/** DEK rotation (A2.3): new active version; caller re-encrypts that org's rows. */
export async function rotateOrgDek(orgId: string): Promise<number> {
  const d = await getDriver();
  return withSystemCtx(async () => {
    const latest = await d.prepare(
      'SELECT MAX(key_version) AS v FROM org_encryption_keys WHERE org_id = ?'
    ).get(orgId) as { v: number | null };
    const nextVersion = Number(latest.v ?? 0) + 1;
    const dek = randomBytes(32);
    // New-version wraps carry their own kv in the wrap AAD.
    const wrapped = (() => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kek(), iv);
      cipher.setAAD(Buffer.from(`kek|org|${orgId}|kv${nextVersion}`));
      const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
      return Buffer.concat([iv, ct]);
    })();
    await d.prepare(
      "INSERT INTO org_encryption_keys (id, org_id, key_version, wrapped_dek, state, created_at) VALUES (?,?,?,?, 'active', ?)"
    ).run(`oek-${orgId}-${nextVersion}`, orgId, nextVersion, wrapped.toString('base64'), new Date().toISOString());
    await d.prepare(
      "UPDATE org_encryption_keys SET state = 'retired' WHERE org_id = ? AND key_version < ? AND state = 'active'"
    ).run(orgId, nextVersion);
    dekCache.delete(orgId);
    return nextVersion;
  });
}

/**
 * Crypto-shredding (A2.4 step 3): overwrite the wrapped DEK bytes and mark
 * every version destroyed. Every GCM ciphertext of this org becomes
 * permanently undecryptable — including WORM-retained object bytes sealed
 * under SSE-C with this DEK (A3.3).
 */
export async function shredOrgKeys(orgId: string): Promise<number> {
  const d = await getDriver();
  return withSystemCtx(async () => {
    const rows = await d.prepare('SELECT id FROM org_encryption_keys WHERE org_id = ? AND state != ?').all(orgId, 'destroyed') as { id: string }[];
    for (const r of rows) {
      const junk = randomFillSync(Buffer.alloc(64)).toString('base64');
      await d.prepare(
        "UPDATE org_encryption_keys SET wrapped_dek = ?, state = 'destroyed', destroyed_at = ? WHERE id = ?"
      ).run(junk, new Date().toISOString(), r.id);
    }
    dekCache.delete(orgId);
    return rows.length;
  });
}

/** Fingerprint helper for evidence trails (not used for secrecy). */
export const sha256b64 = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 16);
