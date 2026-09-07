import { NextRequest, NextResponse } from 'next/server';
import {requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { getCaseForOrg, getEventsForCase, getDocumentsForCase } from '@/lib/db';
import { deriveDeadlines, urgencyOf } from '@/lib/engine';
import { buildICalendar } from '@/lib/ical';
import type { CaseData } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id/deadlines-ics — iCalendar export for the Deadline Radar.
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const { id } = await ctx.params;
  const c = await getCaseForOrg(id, guard.ctx.orgId);
  if (!c) return notFound('case');
  const caseData = { ...c, events: await getEventsForCase(id), documents: await getDocumentsForCase(id) } as unknown as CaseData;
  const items = deriveDeadlines(caseData).map(d => ({ ...d, urgency: urgencyOf(d.dueAt, false), daysLeft: 0 }));
  const ics = buildICalendar({ number: c.number, court: c.court }, items);
  // HTTP headers are ByteStrings — the Arabic case number must be URL-encoded
  // via RFC 5987 filename*, with a safe ASCII fallback name.
  const utf8Name = `deadline-radar-${(c.number || 'case').replace(/[^\w-]+/g, '_')}.ics`;
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="deadline-radar-${c.id.slice(0, 8)}.ics"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`
    }
  });

});
