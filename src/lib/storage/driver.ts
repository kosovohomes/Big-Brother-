// Phase A (A1.1): StorageDriver interface — the single data-access primitive
// behind the db.ts facade. Two implementations:
//   sqlite-driver.mjs — wraps node:sqlite DatabaseSync (dev/test default)
//   pg-driver.mjs     — pg Pool for Postgres 16 (STORAGE_BACKEND=pg)
// All statement methods are async so both dialects share one call shape.

export interface RunResult {
  changes: number;
}

export interface Stmt {
  get(...params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(...params: unknown[]): Promise<Record<string, unknown>[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface StorageDriver {
  dialect: 'sqlite' | 'pg';
  /** Request-context aware prepared statement. On pg this binds to the
   *  request-scoped client from AsyncLocalStorage when present (GUC-scoped),
   *  else to the short-lived bb_app pool (fail-closed: no GUCs → no tenant
   *  rows per RLS policy). */
  prepare(sql: string): Stmt;
  exec(sql: string): Promise<void>;
}

export interface TenantCtx {
  kind: 'tenant' | 'user' | 'system';
  orgId?: string;
  userId?: string;
  role?: string;
}
