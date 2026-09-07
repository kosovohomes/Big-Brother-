import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, notFound, withOrg } from '@/lib/api-helpers';
import { uuid, nowIso, mapEvent, audit } from '@/lib/db';
import { getDriver } from '@/lib/storage';
import { EVENT_TYPES } from '@/lib/rules/catalog';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/cases/:id/events — add a timeline event (manual entry is the
// primary supported path per PRD Change 9).
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');
  const { date, title, type, note, appealFiled, defect } = await readJson<{
    date?: string; title?: string; type?: string; note?: string; appealFiled?: boolean; defect?: boolean;
  }>(req);
  if (!date || !title) return json({ error: 'date and title are required' }, 400);
  const validTypes = EVENT_TYPES.map(t => t.value);
  const eventType = validTypes.includes(String(type)) ? String(type) : 'other';
  const eventId = uuid();
  await d.prepare('INSERT INTO case_events (id, case_id, date, title, type, note, appeal_filed, defect, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(eventId, id, String(date), String(title), eventType, note || '', appealFiled ? 1 : 0, defect ? 1 : 0, nowIso());
  await d.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  await audit('event.create', `${id}/${eventType}`, guard.ctx.orgId, guard.ctx.uid);
  return json({ ok: true, event: mapEvent(await d.prepare('SELECT * FROM case_events WHERE id = ?').get(eventId)) }, 201);

});
