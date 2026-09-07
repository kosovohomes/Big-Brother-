import { NextRequest } from 'next/server';
import {json, requireOrg, forbidden, withOrg } from '@/lib/api-helpers';
import { setOrgPlan } from '@/lib/db';

// POST /api/billing/cancel — downgrade the ACTIVE workspace to FREE.
// OWNER/ADMIN only. In Stripe mode a production build would call the Customer
// Portal / subscriptions API; here (and in demo mode) the plan is downgraded
// immediately with a full billing-ledger + audit record. Capacity limits apply
// again right away — existing data is never deleted by a downgrade.
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'OWNER' && guard.role !== 'ADMIN') return forbidden();

  const org = await setOrgPlan(guard.ctx.orgId, 'FREE', {
    status: 'canceled',
    renewsAt: null,
    kind: 'downgrade',
    detail: 'canceled by workspace owner — capacity limits re-applied, data retained',
    actor: guard.ctx.uid
  });
  return json({ ok: true, org });

});
