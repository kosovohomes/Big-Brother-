import { NextRequest } from 'next/server';
import { json, unauthorized, forbidden, notFound, readJson, setSessionCookie, planLimitReached } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { getOrgById, getOrgByJoinCode, getMembershipRole, countOrgMembers, insertMembership, audit } from '@/lib/db';
import { withSystemCtx } from '@/lib/storage';
import { PLANS } from '@/lib/billing';

// POST /api/auth/switch-org — multi-tenant switcher.
// Body: { orgId } to switch to a membership you hold, or { joinCode } to join
// an NGO / law-firm workspace by invite code (role MEMBER; upgrade by an admin).
// Join-code enumeration returns the same 404 shape for every miss (T-16).
// Auth-route reads/writes run system-scoped on pg (A2.1 role model) — the
// membership checks below stay enforced in server code.
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthorized();
  const { orgId, joinCode } = await readJson<{ orgId?: string; joinCode?: string }>(req);

  return withSystemCtx(async () => {
  let targetId = orgId;
  let role = '';

  if (joinCode) {
    const org = await getOrgByJoinCode(String(joinCode).trim().toUpperCase());
    if (!org) return notFound('workspace for that invite code');
    const existingRole = await getMembershipRole(session.uid, org.id);
    if (existingRole) {
      targetId = org.id; role = existingRole;
    } else {
      // Plan capacity limit (Stage 5): seats per workspace.
      const plan = org.plan === 'PRO' ? 'PRO' : 'FREE';
      const members = await countOrgMembers(org.id);
      if (members >= PLANS[plan].limits.maxMembers) {
        return planLimitReached('maxMembers', plan, PLANS[plan].limits.maxMembers);
      }
      await insertMembership(session.uid, org.id, 'MEMBER');
      await audit('org.join', `${org.slug} via code`, org.id, session.uid);
      targetId = org.id; role = 'MEMBER';
    }
  } else if (orgId) {
    const r = await getMembershipRole(session.uid, String(orgId));
    if (!r) return forbidden();
    targetId = String(orgId); role = r;
  } else {
    return json({ error: 'orgId or joinCode required' }, 400);
  }

  const org = await getOrgById(targetId!);
  if (!org) return notFound('organization');
  await audit('org.switch', org.slug, org.id, session.uid);

  const res = json({ ok: true, activeOrg: org, role });
  setSessionCookie(res, { uid: session.uid, email: session.email, name: session.name, orgId: org.id, role });
  return res;
  });
}
