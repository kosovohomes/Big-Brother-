import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getBillingSummary } from '@/lib/db';
import { stripeConfigured } from '@/lib/billing';

// GET /api/billing — plan, status, live usage vs limits, and the billing
// ledger for the ACTIVE workspace. Readable by every member (transparency);
// management actions are OWNER/ADMIN only (enforced in the POST routes).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const summary = await getBillingSummary(guard.ctx.orgId, guard.role);
  if (!summary) return json({ error: 'billing summary unavailable' }, 404);
  return json({ ...summary, stripeConfigured: stripeConfigured() });

});
