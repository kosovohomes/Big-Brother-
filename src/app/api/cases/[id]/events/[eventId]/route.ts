import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { audit } from '@/lib/db';
import { getDriver } from '@/lib/storage';

type Ctx = { params: Promise<{ id: string; eventId: string }> };

// DELETE /api/cases/:id/events/:eventId
export const DELETE = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id, eventId } = await ctx.params;
  const row = await d.prepare(
    `SELECT e.id FROM case_events e JOIN cases c ON c.id = e.case_id
     WHERE e.id = ? AND e.case_id = ? AND c.org_id = ?`).get(eventId, id, guard.ctx.orgId);
  if (!row) return notFound('event');
  await d.prepare('DELETE FROM case_events WHERE id = ?').run(eventId);
  await audit('event.delete', `${id}/${eventId}`, guard.ctx.orgId, guard.ctx.uid);
  return json({ ok: true });

});
