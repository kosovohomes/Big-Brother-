// Phase A (A1.1): driver selection + request-scoped execution contexts.
//
// STORAGE_BACKEND=sqlite (default) — node:sqlite singleton; contexts are
//   no-ops and tenancy is enforced in app code exactly as before Phase A.
// STORAGE_BACKEND=pg — Postgres 16; requireOrg opens a request-scoped client
//   with session GUCs (app.org_id / app.user_id / app.role) so RLS policies
//   (scripts/pg/004_rls_policies.sql) scope every statement of the request.
//   The client is released after the response finishes (Next.js after()).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { StorageDriver, TenantCtx } from './driver';

export type { StorageDriver, TenantCtx, Stmt, RunResult } from './driver';

export const backend = (): 'sqlite' | 'pg' =>
  process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'sqlite';

// Bundle-safe singletons (one instance across every route bundle — see
// pg-driver.mjs). Keyed on globalThis so ALS and the active driver are shared.
const G = globalThis as typeof globalThis & {
  __bbRequestScope?: AsyncLocalStorage<TenantCtx & { client?: unknown }>;
  __bbDriver?: StorageDriver;
  __bbDriverPending?: Promise<StorageDriver> | null;
};
export const requestScope = (G.__bbRequestScope ??= new AsyncLocalStorage<TenantCtx & { client?: unknown }>());

let active: StorageDriver | null = null;
let pending: Promise<StorageDriver> | null = null;

export function getDriver(): Promise<StorageDriver> {
  if (G.__bbDriver) return Promise.resolve(G.__bbDriver);
  if (G.__bbDriverPending) return G.__bbDriverPending;
  pending = (async () => {
    if (backend() === 'pg') {
      if (!process.env.DATABASE_URL) {
        throw new Error('STORAGE_BACKEND=pg requires DATABASE_URL');
      }
      const drv = await import('./pg-driver.mjs');
      active = {
        dialect: 'pg',
        prepare: (sql) => drv.prepare(sql),
        exec: (sql) => drv.exec(sql)
      };
    } else {
      const drv = await import('./sqlite-driver.mjs');
      active = {
        dialect: 'sqlite',
        prepare: (sql) => drv.prepare(sql),
        exec: (sql) => drv.exec(sql)
      };
    }
    G.__bbDriver = active;
    return active;
  })();
  G.__bbDriverPending = pending;
  return pending;
}

/** Synchronous access for modules that already awaited getDriver() once. */
export function driverNow(): StorageDriver {
  const d = G.__bbDriver;
  if (!d) throw new Error('storage driver not initialised — await getDriver() first');
  return d;
}

async function begin(kind: TenantCtx['kind'], ids: { orgId?: string; userId?: string; role?: string } = {}) {
  const ctx: TenantCtx & { client?: unknown } = { kind, ...ids };
  if (backend() === 'pg') {
    const drv = await import('./pg-driver.mjs');
    await drv.beginScope(ctx);
  }
  return ctx;
}

export async function endScope(ctx: TenantCtx & { client?: unknown }) {
  if (backend() === 'pg') {
    const drv = await import('./pg-driver.mjs');
    await drv.endScope(ctx);
  }
}

/**
 * Bind a tenant-scoped client into an EXISTING shared ALS store (see withOrg
 * in api-helpers): requireOrg mutates the store the handler body already
 * runs in, so RLS GUCs apply to every facade call downstream. No-op on sqlite.
 */
export async function bindTenantScope(store: TenantCtx & { client?: unknown }, orgId: string, userId: string, role: string) {
  if (backend() !== 'pg') return store;
  const drv = await import('./pg-driver.mjs');
  store.kind = 'tenant';
  store.orgId = orgId;
  store.userId = userId;
  store.role = role;
  await drv.beginScope(store);
  return store;
}

/** User-scoped scope (auth/me, logout): only app.user_id is set. */
export async function withUserCtx<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = await begin('user', { userId });
  try {
    return await requestScope.run(ctx, fn);
  } finally {
    await endScope(ctx);
  }
}

/**
 * System scope (register/login lookup, switch-org join, webhook, reaper,
 * seed, cross-user notification fan-out). Owner-equivalent operational role;
 * every call site is a named server-side path (PHASE_A_SPEC A2.1 role model,
 * C-A8). On sqlite it just runs inline.
 */
export async function withSystemCtx<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await begin('system');
  try {
    return await requestScope.run(ctx, fn);
  } finally {
    await endScope(ctx);
  }
}

/** Boot guard (C-A7): pg mode MUST have an explicit SESSION_SECRET. */
export function assertBootConfig(): string[] {
  const problems: string[] = [];
  if (backend() === 'pg' && !process.env.SESSION_SECRET) {
    problems.push('STORAGE_BACKEND=pg requires an explicit SESSION_SECRET (C-A7)');
  }
  return problems;
}
