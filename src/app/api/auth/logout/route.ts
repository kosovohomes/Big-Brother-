import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { SESSION_COOKIE, getSession } from '@/lib/auth';
import { revokeAllSessions } from '@/lib/db';

// POST /api/auth/logout — clears the session cookie AND revokes it (C-A7):
// `sessions_invalid_before` is set so a replayed stateless cookie is dead on
// arrival (e2e T-21). Coarse-grained by design (PHASE_A_SPEC §5 decision 5).
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (session) await revokeAllSessions(session.uid);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
