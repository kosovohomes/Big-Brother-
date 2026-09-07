import { NextRequest } from 'next/server';
import { json, setSessionCookie, readJson } from '@/lib/api-helpers';
import { registerUserAndOrg, findUserByEmail, hashPassword, audit } from '@/lib/db';

// POST /api/auth/register — email/password signup.
// Every new user gets a personal Organization (their own tenant workspace).
// The user+org+membership triple is written in a system-scoped transaction
// (PHASE_A_SPEC A2.1: registration is the SECURITY DEFINER equivalent).
export async function POST(req: NextRequest) {
  const { email, password, name, orgName } = await readJson<{ email?: string; password?: string; name?: string; orgName?: string }>(req);
  if (!email || !password || !name) return json({ error: 'email, password and name are required' }, 400);
  const normEmail = String(email).trim().toLowerCase();

  const existing = await findUserByEmail(normEmail);
  if (existing) return json({ error: 'email already registered' }, 409);

  const { uid, orgId } = await registerUserAndOrg({
    email: normEmail,
    passwordHash: hashPassword(String(password)),
    name: String(name),
    orgName
  });
  await audit('auth.register', normEmail, orgId, uid);

  const res = json({ ok: true, user: { id: uid, email: normEmail, name } }, 201);
  setSessionCookie(res, { uid, email: normEmail, name: String(name), orgId, role: 'OWNER' });
  return res;
}
