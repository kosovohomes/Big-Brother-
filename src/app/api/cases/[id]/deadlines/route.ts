import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { nowIso, getCaseForOrg, getEventsForCase, getDocumentsForCase } from '@/lib/db';
import { deriveDeadlines, urgencyOf } from '@/lib/engine';
import type { CaseData } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id/deadlines — Deadline Radar (derived statutory windows +
// upcoming sessions), with urgency classes for the calendar coloring.
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { id } = await ctx.params;
  const c = await getCaseForOrg(id, guard.ctx.orgId);
  if (!c) return notFound('case');
  const caseData = { ...c, events: await getEventsForCase(id), documents: await getDocumentsForCase(id) } as unknown as CaseData;
  const items = deriveDeadlines(caseData).map(d => ({
    ...d,
    urgency: urgencyOf(d.dueAt, false),
    daysLeft: Math.floor((new Date(d.dueAt).getTime() - Date.now()) / 86400000)
  }));
  return json({ deadlines: items, generatedAt: nowIso() });

});
