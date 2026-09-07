import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, notFound, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, getCaseForOrg, getEventsForCase, getDocumentsForCase, getAllActiveProvisions, getDraftsForCaseOrg, getDraftForOrg, getDriver, audit } from '@/lib/db';
import { buildDraftPayload, DRAFT_TYPES } from '@/lib/packs';
import { exportAckBilingual, BANNER_VERSION } from '@/lib/banners';
import { notifyReviewersOfDraft } from '@/lib/notifications';
import { encryptField } from '@/lib/crypto';
import type { CaseData, EngineResult } from '@/lib/types';
import { analyze } from '@/lib/engine';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id/drafts — draft list with cooling-off/review status.
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { id } = await ctx.params;
  const drafts = await getDraftsForCaseOrg(id, guard.ctx.orgId);
  const now = Date.now();
  return json({
    drafts: drafts.map(d => {
      const coolingOffEndsAt = d?.finalizedAt && d.coolingOffHours > 0
        ? new Date(new Date(d.finalizedAt).getTime() + d.coolingOffHours * 3600_000).toISOString()
        : null;
      return {
        ...d,
        coolingOffEndsAt,
        coolingOffRemainingSec: coolingOffEndsAt
          ? Math.max(0, Math.floor((new Date(coolingOffEndsAt).getTime() - now) / 1000))
          : 0,
        exportable: d?.status === 'RELEASED' || (d?.status === 'FINALIZED' && (!coolingOffEndsAt || now >= new Date(coolingOffEndsAt).getTime()))
      };
    }),
    types: DRAFT_TYPES.map(t => ({ id: t.id, ar: t.ar, en: t.en, coolingOffHours: t.coolingOffHours, reviewRequired: t.reviewRequired, defamationWarning: t.defamationWarning }))
  });

});

// POST /api/cases/:id/drafts — LAYER 2: case-specific Discussion Draft.
// PRD 5.5 AC6 + 5.6 AC3 + 9.3: only created on an explicit user action, with
// the mandatory acknowledgment accepted at generation time (logged), never
// auto-populated as the default view. Misconduct/Nazaha drafts (5.8 AC4)
// carry a 24h cooling-off and, when the org runs a review queue, are routed
// to human review before release. Payload is encrypted at rest (A2.3).
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');

  const { type, ackAccepted } = await readJson<{ type?: string; ackAccepted?: boolean }>(req);
  if (!ackAccepted) {
    return json({
      error: 'mandatory acknowledgment not accepted',
      detail: 'PRD 5.6 AC4: the not-legal-advice acknowledgment must be affirmatively accepted when a discussion draft is generated.'
    }, 428); // Precondition Required
  }
  const def = DRAFT_TYPES.find(t => t.id === type);
  if (!def) return json({ error: 'unknown draft type' }, 400);

  const c = await getCaseForOrg(id, guard.ctx.orgId);
  const caseData = { ...c, events: await getEventsForCase(id), documents: await getDocumentsForCase(id) } as unknown as CaseData;
  const engineResult: EngineResult = analyze(caseData, await getAllActiveProvisions());
  const payload = buildDraftPayload(def.id, caseData, engineResult);
  if (!payload) return json({ error: 'cannot build draft payload' }, 500);

  const orgRow = await d.prepare('SELECT review_queue_enabled FROM organizations WHERE id = ?').get(guard.ctx.orgId) as { review_queue_enabled: number };
  const reviewRequired = def.reviewRequired && !!Number(orgRow.review_queue_enabled);
  // For review-queue drafts the cooling-off clock starts at generation
  // (finalizedAt set now) so releasing from review can never bypass the
  // mandatory 24h window (PRD 5.8 AC4).
  const draftId = cuidish();
  const createdAt = nowIso();
  const payloadCipher = await encryptField(guard.ctx.orgId, 'pack_drafts', 'payload', draftId, JSON.stringify(payload));
  await d.prepare(`INSERT INTO pack_drafts
    (id, case_id, org_id, created_by_id, type, title_ar, title_en, payload, status, finalized_at, released_at, exported_at, cooling_off_hours, review_required, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(draftId, id, guard.ctx.orgId, guard.ctx.uid, def.id, def.ar, def.en, payloadCipher,
      reviewRequired ? 'IN_REVIEW' : 'DRAFT',
      reviewRequired ? createdAt : null, null, null, def.coolingOffHours, reviewRequired ? 1 : 0,
      createdAt, createdAt);

  // Acknowledgment audit trail (PRD 5.6 AC4 / 6.7)
  await d.prepare('INSERT INTO acknowledgments (id, user_id, draft_id, kind, banner_version, text_snapshot, accepted_at) VALUES (?,?,?,?,?,?,?)')
    .run(cuidish(), guard.ctx.uid, draftId, 'DRAFT_GENERATION', BANNER_VERSION, exportAckBilingual(), nowIso());
  await audit('draft.generate', `${def.id} for ${id}${reviewRequired ? ' → review queue' : ''}`, guard.ctx.orgId, guard.ctx.uid);

  // Stage 6: review-queue drafts land IN_REVIEW at creation (cooling-off clock
  // starts at generation), so reviewers are notified from here.
  const reviewersNotified = reviewRequired
    ? await notifyReviewersOfDraft(
        { id: draftId, orgId: guard.ctx.orgId, caseId: id, type: def.id, titleAr: def.ar, titleEn: def.en },
        guard.ctx.uid
      )
    : 0;

  return json({
    ok: true,
    draft: await getDraftForOrg(draftId, guard.ctx.orgId),
    coolingOffHours: def.coolingOffHours,
    reviewRequired,
    reviewersNotified
  }, 201);

});
