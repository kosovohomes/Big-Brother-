// Phase A (A1.1): Postgres 16 driver behind the StorageDriver interface.
//
// Role model (PHASE_A_SPEC A2.1):
//   bb_app     — NOBYPASSRLS; all HTTP tenant flows via requireOrg tenant ctx
//                (session GUCs app.org_id / app.user_id / app.role). Fail-closed:
//                an unset GUC yields zero rows for org-scoped tables.
//   bb_system  — owner-equivalent operational role (webhook, reaper, seed,
//                auth register/login lookups). Every use is a named server-side
//                code path wrapped in withSystemCtx(); no client input reaches
//                it beyond bound parameters.
//
// C-A5: billing_events/notifications carry a `seq BIGINT GENERATED ALWAYS AS
// IDENTITY` on pg; the facade orders by seq (sqlite keeps rowid).

import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

export const dialect = 'pg';

// Bundle-safe singletons: Next.js/Turbopack can instantiate a module once per
// route bundle, so module-level state must live on globalThis to be shared.
const G = globalThis;
export const requestScope = (G.__bbRequestScope ??= new AsyncLocalStorage());

const rewrite = (sql) => {
  // Replace top-level `?` placeholders with $1..$n (quote-aware: `?` inside
  // single-quoted literals is never a placeholder in our SQL corpus).
  let out = '';
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inStr = !inStr;
    if (ch === '?' && !inStr) out += `$${++n}`;
    else out += ch;
  }
  return out;
};

const appUrl = process.env.DATABASE_URL || '';
const systemUrl = process.env.DATABASE_URL_SYSTEM || appUrl;
const poolMax = Number(process.env.PG_POOL_MAX || 10);
const stmtTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 8000);

const mkPool = (connectionString) => new pg.Pool({
  connectionString,
  max: poolMax,
  statement_timeout: stmtTimeout,
  idleTimeoutMillis: 30_000
});

export const pool = mkPool(appUrl);
export const systemPool = mkPool(systemUrl);

const mkStmt = (runner, sql) => {
  const text = rewrite(sql);
  return {
    get: async (...params) => {
      const r = await runner.query(text, params);
      return r.rows[0];
    },
    all: async (...params) => {
      const r = await runner.query(text, params);
      return r.rows;
    },
    run: async (...params) => {
      const r = await runner.query(text, params);
      return { changes: r.rowCount ?? 0 };
    }
  };
};

function resolveRunner() {
  const ctx = requestScope.getStore();
  if (ctx && ctx.client) return ctx.client; // tenant / user / system scoped client
  return pool; // unscoped: bb_app pool — fail-closed under RLS (no GUCs set)
}

export function prepare(sql) {
  return mkStmt(resolveRunner(), sql);
}

export const exec = async (sql) => { await pool.query(sql); };

// --- scoped clients -------------------------------------------------------

export async function beginScope(ctx) {
  const isSystem = ctx.kind === 'system';
  const client = await (isSystem ? systemPool : pool).connect();
  try {
    if (ctx.kind === 'tenant') {
      await client.query(
        `SELECT set_config('app.org_id', $1, false), set_config('app.user_id', $2, false), set_config('app.role', $3, false)`,
        [ctx.orgId ?? '', ctx.userId ?? '', ctx.role ?? '']
      );
    } else if (ctx.kind === 'user') {
      await client.query(`SELECT set_config('app.user_id', $1, false)`, [ctx.userId ?? '']);
    }
    // 'system': no GUCs — the role itself (BYPASSRLS) is the operational scope.
  } catch (err) {
    client.release();
    throw err;
  }
  ctx.client = client;
  return ctx;
}

export async function endScope(ctx) {
  if (ctx && ctx.client) {
    const client = ctx.client;
    ctx.client = undefined;
    try {
      await client.query('RESET ALL'); // clear session GUCs before re-pooling
    } catch { /* connection may already be broken; do not mask the original error */ }
    client.release();
  }
}

export async function poolHealth() {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}
