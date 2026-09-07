import { NextRequest } from 'next/server';
import { json, requireOrg, forbidden , withOrg } from '@/lib/api-helpers';
import { getDriver } from '@/lib/db';
import { presignUpload } from '@/lib/storage/object-store';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/cases/:id/documents/presign — direct-upload presign (A3.4).
// OWNER/ADMIN only. In the current evidence mode (DEK/SSE-C, WORM) the server
// cannot hand a customer key to the client, so this returns a machine-readable
// refusal; the seal path remains POST /documents. T-22 pins the tenancy of
// this endpoint (cross-org access → 404 before any presign attempt).
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'OWNER' && guard.role !== 'ADMIN') return forbidden();
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return json({ error: 'case not found' }, 404);
  const result = await presignUpload(`${guard.ctx.orgId}/${id}`, 300);
  if (!result.ok) return json({ error: 'presign unavailable', detail: result.error }, 501);
  return json({ uploadUrl: result.uploadUrl });
});
