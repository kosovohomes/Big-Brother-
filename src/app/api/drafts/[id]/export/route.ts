import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, notFound, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, getDraftForOrg, getDriver, audit } from '@/lib/db';
import { DRAFT_TYPES } from '@/lib/packs';
import { exportAckBilingual, BANNER_VERSION, DEFAMATION_AR, DEFAMATION_EN } from '@/lib/banners';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/drafts/:id/export — export/download a Discussion Draft.
// Compliance gates (PRD 5.6 AC4 + 5.8 AC4), enforced server-side:
//   1. Mandatory acknowledgment (checkbox + re-displayed banner) accepted NOW,
//      at the moment of export — logged with exact text snapshot.
//   2. Cooling-off: ≥24h since finalize for misconduct/Nazaha drafts.
//   3. Review queue: IN_REVIEW drafts cannot be exported until released.
//   4. Defamation warning re-displayed with the response for misconduct/Nazaha.
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id, type, status, finalized_at, cooling_off_hours FROM pack_drafts WHERE id = ? AND org_id = ?')
    .get(id, guard.ctx.orgId) as { id: string; type: string; status: string; finalized_at: string | null; cooling_off_hours: number } | undefined;
  if (!row) return notFound('draft');
  const def = DRAFT_TYPES.find(t => t.id === row.type);

  const { ackAccepted, format } = await readJson<{ ackAccepted?: boolean; format?: string }>(req);
  if (!ackAccepted) {
    return json({
      error: 'mandatory export acknowledgment not accepted',
      detail: 'PRD 5.6 AC4: the acknowledgment must be affirmatively accepted at the moment of every export/download.',
      defamationWarning: def?.defamationWarning ? { ar: DEFAMATION_AR, en: DEFAMATION_EN } : undefined
    }, 428);
  }
  if (row.status === 'IN_REVIEW') {
    return json({
      error: 'draft is in the human review queue',
      detail: 'PRD 5.8 AC4: a misconduct/Nazaha draft routed to review must be released by a lawyer/admin before it can be exported.'
    }, 423); // Locked
  }
  if (row.status === 'DRAFT') {
    return json({ error: 'draft must be finalized before export', detail: 'Finalize the draft first; cooling-off starts at finalization for regulated types.' }, 409);
  }
  if (row.finalized_at && row.cooling_off_hours > 0) {
    const endsAt = new Date(row.finalized_at).getTime() + row.cooling_off_hours * 3600_000;
    if (Date.now() < endsAt) {
      const remainingSec = Math.ceil((endsAt - Date.now()) / 1000);
      return json({
        error: 'cooling-off period active',
        remainingSec,
        detail: 'PRD 5.8 AC4: a mandatory cooling-off period applies between finalization and export of this draft category.',
        defamationWarning: def?.defamationWarning ? { ar: DEFAMATION_AR, en: DEFAMATION_EN } : undefined
      }, 423);
    }
  }

  await d.prepare("UPDATE pack_drafts SET status = 'EXPORTED', exported_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  await d.prepare('INSERT INTO acknowledgments (id, user_id, draft_id, kind, banner_version, text_snapshot, accepted_at) VALUES (?,?,?,?,?,?,?)')
    .run(cuidish(), guard.ctx.uid, id, 'EXPORT', BANNER_VERSION, exportAckBilingual(), nowIso());
  await audit('draft.export', `${row.type} (${format || 'json'})`, guard.ctx.orgId, guard.ctx.uid);

  return json({
    ok: true,
    draft: await getDraftForOrg(id, guard.ctx.orgId),
    defamationWarning: def?.defamationWarning ? { ar: DEFAMATION_AR, en: DEFAMATION_EN } : undefined,
    coverNotice: { ar: 'هذه مسودة نقاش تعليمية وُلِّدت آليًا انطلاقًا من معلومات قانونية عامة. هي ليست استشارة قانونية، ولم يراجعها محامٍ، ولا يجوز إيداعها أمام أي محكمة أو جهة دون مراجعة قانونية مستقلة.', en: 'This is an educational discussion draft generated from general legal information. It is not legal advice, has not been reviewed by a lawyer, and must not be filed with any court without independent legal review.' }
  });

});
