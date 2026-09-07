import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, planLimitReached, withOrg } from '@/lib/api-helpers';
import { getCaseForOrg, getEventsForCase, getDocumentsForCase, getAllActiveProvisions, getOrgById, getOrgUsage, audit } from '@/lib/db';
import { PLANS } from '@/lib/billing';
import { analyze } from '@/lib/engine';
import { buildEducationalBreakdown } from '@/lib/counterReply';
import { GROUND_BANNER_AR, GROUND_BANNER_EN, DISCLAIMER_AR, DISCLAIMER_EN } from '@/lib/banners';
import type { CaseData } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id/analysis — Layer 1 (educational explainer, DEFAULT view):
// procedural alerts + dismissal-ground educational categories + Deadline Radar.
// Layer 2 (case-specific Discussion Draft) is a separate explicit action
// via /api/cases/:id/drafts (PRD 5.5 AC6).
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { id } = await ctx.params;
  const c = await getCaseForOrg(id, guard.ctx.orgId);
  if (!c) return notFound('case');

  // Fair-use metering (Stage 5): monthly procedural analyses per workspace.
  // The run counter is the audit trail entry written below (transparency).
  const org = await getOrgById(guard.ctx.orgId);
  const plan = org?.plan === 'PRO' ? 'PRO' : 'FREE';
  const usage = await getOrgUsage(guard.ctx.orgId);
  if (usage.monthlyAnalysisRuns >= PLANS[plan].limits.monthlyAnalysisRuns) {
    return planLimitReached('monthlyAnalysisRuns', plan, PLANS[plan].limits.monthlyAnalysisRuns);
  }
  await audit('analysis.run', id, guard.ctx.orgId, guard.ctx.uid);

  const caseData = { ...c, events: await getEventsForCase(id), documents: await getDocumentsForCase(id) } as unknown as CaseData;
  const result = analyze(caseData, await getAllActiveProvisions());
  const breakdown = c.opponentPleading ? buildEducationalBreakdown(c) : null;

  return json({
    ...result,
    counterEducational: breakdown, // educational breakdown only — no draft
    banners: {
      ground: { ar: GROUND_BANNER_AR, en: GROUND_BANNER_EN },
      disclaimer: { ar: DISCLAIMER_AR, en: DISCLAIMER_EN }
    }
  });

});
