import { NextResponse } from 'next/server';
import { getActiveProvisionCount, withSystemCtx } from '@/lib/db';
import { backend } from '@/lib/storage';

// GET /api/health — liveness + LKB composition. The count is a global corpus
// read (C-A9): on pg it runs system-scoped (P13 requires a user GUC; health
// has no session).
export async function GET() {
  let corpus = 0;
  try {
    corpus = await withSystemCtx(() => getActiveProvisionCount());
  } catch { /* pre-seed */ }
  return NextResponse.json({
    ok: true, service: 'big-brother', version: '2.1',
    db: backend() === 'pg' ? 'postgres' : 'node:sqlite',
    corpus
  });
}
