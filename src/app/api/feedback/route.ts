import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, audit, getDriver } from '@/lib/db';

// POST /api/feedback — Helpful / Not Helpful / Needs-more-facts feedback loop
// (PRD 5.3 AC3, 5.5 AC4).
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { caseId, targetType, targetId, value } = await readJson<{
    caseId?: string; targetType?: string; targetId?: string; value?: string;
  }>(req);
  if (!caseId || !targetId || !value) return json({ error: 'caseId, targetId and value are required' }, 400);
  if (!['helpful', 'not_helpful', 'needs_facts'].includes(String(value))) {
    return json({ error: 'value must be helpful | not_helpful | needs_facts' }, 400);
  }
  const owned = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(String(caseId), guard.ctx.orgId);
  if (!owned) return json({ error: 'case not found in this workspace' }, 404);

  await d.prepare(`INSERT INTO feedbacks (id, user_id, case_id, target_type, target_id, value, created_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(user_id, target_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`)
    .run(cuidish(), guard.ctx.uid, String(caseId), targetType === 'ground' ? 'ground' : 'alert', String(targetId), String(value), nowIso());
  await audit('feedback', `${targetId} = ${value}`, guard.ctx.orgId, guard.ctx.uid);
  return json({ ok: true }, 201);

});
