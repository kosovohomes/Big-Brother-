import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, forbidden, withOrg } from '@/lib/api-helpers';
import { nowIso, getDraftForOrg, getDriver, audit } from '@/lib/db';
import { notifyDraftReleased } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/drafts/:id/release — human review-queue release (PRD 5.8 AC4).
// Only OWNER/ADMIN/LAWYER may release an IN_REVIEW misconduct/Nazaha draft.
export const POST = withOrg(async function (req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (!['OWNER', 'ADMIN', 'LAWYER'].includes(guard.role)) return forbidden();
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id, status, type, case_id, created_by_id, title_ar, title_en FROM pack_drafts WHERE id = ? AND org_id = ?')
    .get(id, guard.ctx.orgId) as { id: string; status: string; type: string; case_id: string; created_by_id: string; title_ar: string; title_en: string } | undefined;
  if (!row) return notFound('draft');
  if (String(row.status) !== 'IN_REVIEW') return json({ error: `draft is not in review (status: ${row.status})` }, 409);

  await d.prepare("UPDATE pack_drafts SET status = 'RELEASED', released_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  await audit('draft.review.release', String(row.type), guard.ctx.orgId, guard.ctx.uid);

  // Stage 6: the draft's creator learns their draft cleared human review.
  const note = await notifyDraftReleased({
    id, orgId: guard.ctx.orgId, caseId: String(row.case_id), type: String(row.type),
    titleAr: String(row.title_ar), titleEn: String(row.title_en),
    createdById: String(row.created_by_id)
  }, guard.ctx.uid);
  return json({ ok: true, draft: await getDraftForOrg(id, guard.ctx.orgId), creatorNotified: !!note });
});
