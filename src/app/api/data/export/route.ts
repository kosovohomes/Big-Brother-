import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { listCasesForOrg, getEventsForCase, getDocumentsForCase, audit, getAllActiveProvisions, getDriver } from '@/lib/db';
import { analyze } from '@/lib/engine';
import type { CaseData } from '@/lib/types';

// GET /api/data/export — "Export my timeline" (PRD 5.10): tenant-scoped JSON
// bundle of the user's workspaces: cases, events, documents (hashes only),
// analysis snapshots, and acknowledgments.
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const provisions = await getAllActiveProvisions();
  const cases = [];
  for (const c of await listCasesForOrg(guard.ctx.orgId)) {
    const full = { ...c, events: await getEventsForCase(c.id), documents: await getDocumentsForCase(c.id) } as unknown as CaseData;
    cases.push({
      ...full,
      analysis: analyze(full, provisions)
    });
  }
  const acks = await d.prepare('SELECT kind, draft_id, banner_version, accepted_at FROM acknowledgments WHERE user_id = ? ORDER BY accepted_at DESC').all(guard.ctx.uid);
  await audit('data.export', `org=${guard.ctx.orgId}`, guard.ctx.orgId, guard.ctx.uid);

  return json({
    exportedAt: new Date().toISOString(),
    bannerVersion: 'v2.1',
    workspaceId: guard.ctx.orgId,
    cases,
    acknowledgments: acks,
    notice: 'Exported data contains general legal information only, not legal advice. Treat document hashes as integrity attestations.'
  });

});
