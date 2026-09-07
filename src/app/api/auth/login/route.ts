import { NextRequest } from 'next/server';
import { json, setSessionCookie, readJson } from '@/lib/api-helpers';
import { findUserByEmail, getOrgsForUser, audit } from '@/lib/db';
import { verifyPassword } from '@/lib/db';

// POST /api/auth/login — sets the HMAC-signed session cookie.
// Default org = user's first membership. Lookup is system-scoped on pg
// (users are RLS user-visible only); scheduled-deletion accounts stay 403.
export async function POST(req: NextRequest) {
  const { email, password } = await readJson<{ email?: string; password?: string }>(req);
  if (!email || !password) return json({ error: 'email and password are required' }, 400);
  const normEmail = String(email).trim().toLowerCase();
  const user = await findUserByEmail(normEmail);
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return json({ error: 'invalid credentials' }, 401);
  }
  if (user.deleteScheduledAt) return json({ error: 'account is scheduled for deletion' }, 403);

  const orgs = await getOrgsForUser(user.id);
  if (!orgs.length) return json({ error: 'no workspace found for this account' }, 403);
  const first = orgs[0];
  await audit('auth.login', normEmail, first.id, user.id);

  const res = json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
    orgs,
    activeOrgId: first.id,
    role: 'OWNER'
  });
  setSessionCookie(res, { uid: user.id, email: user.email, name: user.name, orgId: first.id, role: 'OWNER' });
  return res;
}
