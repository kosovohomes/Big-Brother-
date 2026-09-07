import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, unauthorized, withOrg } from '@/lib/api-helpers';
import { getSession } from '@/lib/auth';
import { scheduleAccountDelete, getDriver, audit } from '@/lib/db';

// POST /api/data/delete — "Delete my account & data" (PRD 5.10 AC1).
// mode:
//  - "workspace": purge all case data of the CURRENT workspace immediately
//    (cases cascade to events/documents/drafts; hashes included).
//  - "account": schedule the account for deletion (7-day workflow, confirmed
//    by the UI); login is blocked once scheduled. Phase A adds the reaper
//    (scripts/reaper.mjs, A2.4/A5) that actually completes the workflow —
//    closing compliance gap C-A2.
export const POST = withOrg(async function(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthorized();
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { mode } = await readJson<{ mode?: string }>(req);

  if (mode === 'account') {
    const scheduledAt = await scheduleAccountDelete(session.uid);
    await audit('data.delete.scheduled', '7-day workflow started', guard.ctx.orgId, session.uid);
    return json({
      ok: true,
      mode: 'account',
      scheduledAt,
      completesWithinDays: 7,
      confirmation: 'Your account and all data are scheduled for deletion and will be completed within 7 days. You will receive a confirmation.'
    });
  }

  // default: purge current workspace data
  const cnt = await d.prepare('SELECT COUNT(*) AS n FROM cases WHERE org_id = ?').get(guard.ctx.orgId) as { n: number };
  await d.prepare('DELETE FROM cases WHERE org_id = ?').run(guard.ctx.orgId);
  await d.prepare('DELETE FROM pack_drafts WHERE org_id = ?').run(guard.ctx.orgId);
  await audit('data.delete.workspace', `${Number(cnt.n)} cases purged`, guard.ctx.orgId, session.uid);
  return json({ ok: true, mode: 'workspace', purgedCases: Number(cnt.n) });

});
