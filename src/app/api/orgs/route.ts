import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, withOrg } from '@/lib/api-helpers';
import { getOrgsForUser, createOrg, audit } from '@/lib/db';

// GET /api/orgs — list workspaces the user belongs to.
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  return json({ orgs: await getOrgsForUser(guard.ctx.uid) });

});

// POST /api/orgs — create a new workspace (tenant): INDIVIDUAL | NGO | LAW_FIRM.
// NGOs can enable the misconduct/Nazaha review queue (PRD 5.8 AC4).
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { name, type, reviewQueueEnabled } = await readJson<{ name?: string; type?: string; reviewQueueEnabled?: boolean }>(req);
  if (!name) return json({ error: 'name is required' }, 400);
  const orgType = ['INDIVIDUAL', 'NGO', 'LAW_FIRM'].includes(String(type)) ? String(type) : 'INDIVIDUAL';

  const org = await createOrg({
    name: String(name), type: orgType,
    reviewQueueEnabled: !!reviewQueueEnabled,
    ownerId: guard.ctx.uid
  });
  await audit('org.create', `${org.slug} (${orgType})`, org.id, guard.ctx.uid);
  return json({ org }, 201);

});
