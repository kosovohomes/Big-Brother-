import { NextRequest } from 'next/server';
import { json, requireOrg, forbidden, notFound, readJson, withOrg } from '@/lib/api-helpers';
import { nowIso, getDriver, audit } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orgs/:id/delete — OWNER-initiated org offboarding (Phase A A2.4).
// Schedules the workspace for deletion (7-day workflow, completed by
// scripts/reaper.mjs: crypto-shred of org DEKs -> purge -> tombstone).
// Double-confirmation required: body { confirm: "DELETE" }.
// Human decision 5.7: whether this surfaces in the UI or stays an
// operations-runbook action - the capability exists either way.
export const POST = withOrg(async function (req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'OWNER') return forbidden();
  const d = await getDriver();
  const { id } = await ctx.params;
  const org = await d.prepare('SELECT id, slug, plan FROM organizations WHERE id = ?').get(id, guard.ctx.orgId) as { id: string; slug: string; plan: string } | undefined;
  if (!org) return notFound('organization');

  const { confirm } = await readJson<{ confirm?: string }>(req);
  if (confirm !== 'DELETE') {
    return json({
      error: 'double confirmation required',
      detail: 'Send { confirm: "DELETE" } to schedule this workspace for deletion. Deletion completes within 7 days: encryption keys are destroyed (all drafts and case free-text become permanently unreadable), workspace rows are purged, and the workspace is tombstoned. WORM-sealed evidence hashes remain as the evidentiary chain.',
      confirmToken: 'DELETE'
    }, 428);
  }

  const scheduledAt = nowIso();
  await d.prepare('UPDATE organizations SET delete_scheduled_at = ?, updated_at = ? WHERE id = ?')
    .run(scheduledAt, scheduledAt, id);
  await audit('org.delete.scheduled', `org=${id} (${org.slug}) - 7-day offboarding started`, id, guard.ctx.uid);
  return json({
    ok: true,
    orgId: id,
    scheduledAt,
    completesWithinDays: 7,
    confirmation: 'Workspace deletion scheduled. All encryption keys will be destroyed and workspace data permanently removed within 7 days.'
  });
});
