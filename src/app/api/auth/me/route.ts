import { NextRequest } from 'next/server';
import { json, unauthorized } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { getUserById, getOrgsForUser, getOrgById, getMembershipRole } from '@/lib/db';
import { withUserCtx } from '@/lib/storage';

// GET /api/auth/me — session introspection: user, memberships, active org.
// Reads run user-scoped (app.user_id only) so pg RLS P1/P2/P3 see exactly the
// requester's rows.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthorized();
  return withUserCtx(session.uid, async () => {
    const user = await getUserById(session.uid);
    if (!user) return unauthorized();
    const orgs = await getOrgsForUser(session.uid);
    const activeOrg = await getOrgById(session.orgId);
    const role = (await getMembershipRole(session.uid, session.orgId)) || session.role;
    return json({ user, orgs, activeOrg, role });
  });
}
