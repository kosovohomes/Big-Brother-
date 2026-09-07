import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { getDraftForOrg } from '@/lib/db';
import { DRAFT_TYPES } from '@/lib/packs';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/drafts/:id — draft detail + compliance state (payload decrypted
// transparently by the facade — A2.3).
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { id } = await ctx.params;
  const d = await getDraftForOrg(id, guard.ctx.orgId);
  if (!d) return notFound('draft');
  const coolingOffEndsAt = d.finalizedAt && d.coolingOffHours > 0
    ? new Date(new Date(d.finalizedAt).getTime() + d.coolingOffHours * 3600_000).toISOString()
    : null;
  const now = Date.now();
  return json({
    draft: d,
    typeDef: DRAFT_TYPES.find(t => t.id === d.type) || null,
    coolingOffEndsAt,
    coolingOffRemainingSec: coolingOffEndsAt ? Math.max(0, Math.floor((new Date(coolingOffEndsAt).getTime() - now) / 1000)) : 0,
    exportable: d.status === 'RELEASED' || (d.status === 'FINALIZED' && (!coolingOffEndsAt || now >= new Date(coolingOffEndsAt).getTime()))
  });

});
