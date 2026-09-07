import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, notFound, forbidden, withOrg } from '@/lib/api-helpers';
import { nowIso, getCaseForOrg, getEventsForCase, getDocumentsForCase, audit } from '@/lib/db';
import { getDriver } from '@/lib/storage';
import { encryptField } from '@/lib/crypto';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id — full case bundle (case + events + documents), tenant-scoped.
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await getCaseForOrg(id, guard.ctx.orgId);
  if (!row) return notFound('case');
  return json({
    case: row,
    events: await getEventsForCase(id),
    documents: await getDocumentsForCase(id)
  });

});

// PUT /api/cases/:id — update editable fields.
export const PUT = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT * FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');
  const body = await readJson<Record<string, string>>(req);
  const fields = ['number', 'court', 'circuit', 'caseType', 'subType', 'role', 'filedAt', 'servedAt', 'opponent', 'opponentPleading', 'subjectName'];
  const colMap: Record<string, string> = { caseType: 'case_type', subType: 'sub_type', filedAt: 'filed_at', servedAt: 'served_at', opponentPleading: 'opponent_pleading', subjectName: 'subject_name' };
  const sets: string[] = [];
  const vals: string[] = [];
  for (const f of fields) {
    if (f in body) {
      // A2.3: opponent pleading is encrypted at rest before the UPDATE.
      const raw = body[f] ?? '';
      const v = f === 'opponentPleading'
        ? await encryptField(guard.ctx.orgId, 'cases', 'opponent_pleading', id, raw)
        : raw;
      sets.push(`${colMap[f] || f} = ?`); vals.push(v);
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
    await d.prepare(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    await audit('case.update', id, guard.ctx.orgId, guard.ctx.uid);
  }
  return json({ ok: true, case: await getCaseForOrg(id, guard.ctx.orgId) });

});

// DELETE /api/cases/:id — right-to-erasure on a single case (PRD 5.10).
export const DELETE = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const role = guard.role;
  if (!['OWNER', 'ADMIN', 'CASEWORKER'].includes(role) && role !== 'MEMBER') return forbidden();
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');
  await d.prepare('DELETE FROM cases WHERE id = ?').run(id);
  await audit('case.delete', id, guard.ctx.orgId, guard.ctx.uid);
  return json({ ok: true });

});
