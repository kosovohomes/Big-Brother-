// Phase A (A2.4/A5): unified deletion reaper — completes the 7-day deletion
// workflow (PRD 5.10 AC1) that the Task 8 spec found was scheduled-only
// (compliance gap C-A2). Run periodically (cron/systemd); standalone so it
// works with either storage backend:
//   node scripts/reaper.mjs --once
//
// Locking (§A1.5): pg mode takes pg_try_advisory_lock — it must not run
// concurrently on both backends; sqlite mode uses a stale-aware pid file.
//
// What it does for every user/org whose deleteScheduledAt passed 7+ days ago:
//   1. revoke access  — sessions_invalid_before = now (C-A7; login 403 stays)
//   2. crypto-shred   — overwrite wrapped DEKs, state=destroyed → every GCM
//                       ciphertext + SSE-C object byte becomes unrecoverable
//   3. purge rows     — workspace cases/drafts gone (cascades to children)
//   4. redact PII     — user skeletons: name/password/email neutralized
//   5. tombstone orgs — plan=DELETED, slug suffixed (no slug-reuse attacks)
//   6. audit          — append data.delete.completed (hash-only trail, C-A3)
// WORM-locked evidence objects stay in object storage until retentionUntil,
// but their DEK-derived SSE-C keys are shredded (step 2) — "effectively
// destroyed" for the user, "provably unaltered" for the record (A3.3).

import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'data', 'big-brother.db');
const nowIso = () => new Date().toISOString();
const uuid = () => randomBytes(16).toString('hex');
const GRACE_DAYS = 7;

const backend = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'sqlite';
const DRY = process.argv.includes('--dry-run');
const ONCE = process.argv.includes('--once') || true;

async function main() {
  if (backend === 'pg') {
    const { Client } = await import('pg');
    const toPg = (sql) => { // quote-aware ? -> $n (node-postgres has no `?` support)
      let out = '', n = 0, inStr = false;
      for (const ch of sql) { if (ch === "'") inStr = !inStr; out += (ch === '?' && !inStr) ? `$${++n}` : ch; }
      return out;
    };
    const client = new Client({ connectionString: process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL });
    await client.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock(918273645) AS ok');
    if (!lock.rows[0].ok) { console.log('reaper: another instance holds the advisory lock — exiting'); await client.end(); return; }
    try {
      await runOnce(async (sql, params) => (await client.query(toPg(sql), params)).rowCount ?? 0,
        async (sql, params) => (await client.query(toPg(sql), params)).rows);
    } finally {
      await client.query('SELECT pg_advisory_unlock(918273645)');
      await client.end();
    }
  } else {
    const lockFile = join(process.cwd(), 'data', 'reaper.lock');
    if (existsSync(lockFile)) {
      const pid = Number(readFileSync(lockFile, 'utf8').trim());
      try { process.kill(pid, 0); console.log('reaper: live instance detected (pid ' + pid + ') — exiting'); return; }
      catch { unlinkSync(lockFile); } // stale lock
    }
    closeSync(openSync(lockFile, 'w')); writeFileSync(lockFile, String(process.pid));
    try {
      const db = new DatabaseSync(DB_PATH);
      await runOnce(
        (sql, params) => db.prepare(sql).run(...(params || [])).changes,
        (sql, params) => db.prepare(sql).all(...(params || []))
      );
      db.close();
    } finally {
      unlinkSync(lockFile);
    }
  }
}

async function runOnce(run, all) {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86400000).toISOString();
  let actions = 0;

  // ---- user-level deletions (skip already-redacted skeletons) ----
  const users = await all(
    `SELECT id FROM users
      WHERE delete_scheduled_at IS NOT NULL AND delete_scheduled_at <= ?
        AND email NOT LIKE 'deleted-%@invalid'`, [cutoff]);
  for (const u of users) {
    if (DRY) { console.log(`[dry] would delete user ${u.id}`); continue; }
    console.log(`reaper: completing deletion of user ${u.id}`);
    // 1. revoke access
    await run(`UPDATE users SET sessions_invalid_before = ? WHERE id = ?`, [nowIso(), u.id]);
    // 2+3+5. per-org work: shred DEKs / purge / tombstone ONLY when the user
    //    is the org's last member (otherwise the org survives with other members)
    const orgs = await all(
      `SELECT o.id FROM organizations o
        JOIN memberships m ON m.org_id = o.id
        WHERE m.user_id = ? AND o.deleted_at IS NULL`, [u.id]);
    for (const o of orgs) {
      const members = await all(`SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?`, [o.id]);
      if (Number(members[0]?.n) > 1) continue;
      await run(
        `UPDATE org_encryption_keys SET wrapped_dek = ?, state = 'destroyed', destroyed_at = ?
          WHERE org_id = ? AND state <> 'destroyed'`,
        [randomBytes(64).toString('base64'), nowIso(), o.id]);
      await run(`DELETE FROM cases WHERE org_id = ?`, [o.id]);
      await run(`DELETE FROM pack_drafts WHERE org_id = ?`, [o.id]);
      await run(`UPDATE organizations SET plan = 'DELETED', deleted_at = ?, slug = slug || '-deleted-' || substr(id, 1, 6), updated_at = ? WHERE id = ?`,
        [nowIso(), nowIso(), o.id]);
    }
    // 4. redact PII (account skeleton survives; login stays blocked via delete_scheduled_at)
    await run(`UPDATE users SET name = 'deleted', password_hash = 'deleted',
                 email = 'deleted-' || id || '@invalid' WHERE id = ?`, [u.id]);
    await run(`DELETE FROM memberships WHERE user_id = ?`, [u.id]);
    // 6. audit (append-only trail; ids only per C-A3 redaction policy)
    await run(`INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)`,
      [uuid(), orgs[0]?.id ?? null, u.id, nowIso(), 'data.delete.completed', `user=${u.id} 7-day workflow completed`]);
    actions++;
  }

  // ---- org-level offboarding (OWNER-scheduled via /api/orgs/[id]/delete) ----
  const orgs = await all(
    `SELECT id, slug FROM organizations
      WHERE delete_scheduled_at IS NOT NULL AND delete_scheduled_at <= ?
        AND deleted_at IS NULL`, [cutoff]);
  for (const o of orgs) {
    if (DRY) { console.log(`[dry] would delete org ${o.id} (${o.slug})`); continue; }
    console.log(`reaper: completing org offboarding ${o.id} (${o.slug})`);
    await run(`UPDATE users SET sessions_invalid_before = ? WHERE id IN (SELECT user_id FROM memberships WHERE org_id = ?)`, [nowIso(), o.id]);
    await run(
      `UPDATE org_encryption_keys SET wrapped_dek = ?, state = 'destroyed', destroyed_at = ?
        WHERE org_id = ? AND state <> 'destroyed'`,
      [randomBytes(64).toString('base64'), nowIso(), o.id]);
    await run(`DELETE FROM cases WHERE org_id = ?`, [o.id]);
    await run(`DELETE FROM pack_drafts WHERE org_id = ?`, [o.id]);
    await run(`DELETE FROM memberships WHERE org_id = ?`, [o.id]);
    await run(`UPDATE organizations SET plan = 'DELETED', deleted_at = ?, slug = slug || '-deleted-' || substr(id, 1, 6), updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), o.id]);
    await run(`INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)`,
      [uuid(), o.id, null, nowIso(), 'data.delete.completed', `org=${o.id} (${o.slug}) offboarded — DEKs shredded`]);
    actions++;
  }

  console.log(actions ? `reaper: ${actions} deletion(s) completed` : 'reaper: nothing due');
}

main().catch(err => { console.error('reaper failed:', err); process.exit(1); });
