// Phase A (A1.1): SQLite driver — wraps the existing node:sqlite DatabaseSync
// singleton from sqlite.mjs with async signatures. Behavior is byte-for-byte
// today's; this wrapper exists so the facade (db.ts) can serve either dialect
// through one interface and scripts/e2e.mjs runs unchanged on either backend.

import { db } from '../sqlite.mjs';

export const dialect = 'sqlite';

export function prepare(sql) {
  const stmt = db.prepare(sql);
  return {
    get: async (...params) => stmt.get(...params),
    all: async (...params) => stmt.all(...params),
    run: async (...params) => ({ changes: Number(stmt.run(...params).changes) })
  };
}

export const exec = async (sql) => { db.exec(sql); };

// Request-scoped contexts are a no-op on SQLite: the singleton is the only
// connection and tenancy stays enforced in app code (api-helpers requireOrg),
// exactly as today. The hooks exist so index.ts can call them branch-free.
export const beginScope = async () => {};
export const endScope = async () => {};
