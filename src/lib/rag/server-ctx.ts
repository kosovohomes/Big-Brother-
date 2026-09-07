// Server-side storage ctx for the RAG modules (store/pipeline/retriever are
// backend-agnostic .mjs expecting { dialect, all, run, exec }). The server
// adapts the Phase A storage driver into that shape — the same statement
// runner used by every other route, so on Postgres all RAG statements run
// through the request-scoped RLS client exactly like the rest of the API
// (C-R6: RAG routes must use the facade, never raw dialect SQL).
import { getDriver } from '@/lib/storage';

export interface RagCtx {
  dialect: 'sqlite' | 'pg';
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

export async function ragCtx(): Promise<RagCtx> {
  const d = await getDriver();
  return {
    dialect: d.dialect,
    all: (sql, params = []) => d.prepare(sql).all(...params) as Promise<Record<string, unknown>[]>,
    run: async (sql, params = []) => {
      const r = await d.prepare(sql).run(...params);
      return { changes: Number((r as { changes?: number }).changes ?? 0) };
    },
    exec: (sql) => d.exec(sql)
  };
}
