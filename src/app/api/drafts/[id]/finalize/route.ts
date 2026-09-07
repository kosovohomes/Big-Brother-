import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { nowIso, getDriver, audit } from '@/lib/db';
import { DRAFT_TYPES } from '@/lib/packs';
import { notifyReviewersOfDraft } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/drafts/:id/finalize — finalize the draft, starting the 24h
// cooling-off clock for misconduct/Nazaha types (PRD 5.8 AC4). Where the
// organization runs a review queue, the draft is routed IN_REVIEW instead
// and must be explicitly released by a lawyer/admin.
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id, type, status, review_required, case_id FROM pack_drafts WHERE id = ? AND org_id = ?')
    .get(id, guard.ctx.orgId) as { id: string; type: string; status: string; review_required: number; case_id: string } | undefined;
  if (!row) return notFound('draft');
  const status = String(row.status);
  if (status !== 'DRAFT') return json({ error: `cannot finalize a draft in status ${status}` }, 409);

  const def = DRAFT_TYPES.find(t => t.id === String(row.type));
  const reviewRequired = !!Number(row.review_required);
  const nextStatus = reviewRequired ? 'IN_REVIEW' : 'FINALIZED';
  await d.prepare('UPDATE pack_drafts SET status = ?, finalized_at = ?, updated_at = ? WHERE id = ?')
    .run(nextStatus, nowIso(), nowIso(), id);
  await audit('draft.finalize', `${row.type} → ${nextStatus}${def && def.coolingOffHours ? ` (cooling-off ${def.coolingOffHours}h)` : ''}`, guard.ctx.orgId, guard.ctx.uid);

  // Stage 6: when the review queue is involved, reviewers get an inbox item.
  let notified = 0;
  if (nextStatus === 'IN_REVIEW') {
    const full = await d.prepare('SELECT title_ar, title_en FROM pack_drafts WHERE id = ?').get(id) as { title_ar: string; title_en: string };
    notified = await notifyReviewersOfDraft({
      id, orgId: guard.ctx.orgId, caseId: String(row.case_id), type: String(row.type),
      titleAr: String(full.title_ar), titleEn: String(full.title_en)
    }, guard.ctx.uid);
  }
  return json({ ok: true, status: nextStatus, coolingOffHours: def ? def.coolingOffHours : 0, reviewersNotified: notified });

});
