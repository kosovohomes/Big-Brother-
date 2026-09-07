import { NextRequest } from 'next/server';
import {json, requireOrg, forbidden, notFound, readJson, withOrg } from '@/lib/api-helpers';
import {
  getProvisionById, verifyProvision, amendProvision,
  deactivateProvision, reactivateProvision, audit
} from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };
type Body = {
  action?: 'verify' | 'amend' | 'deactivate' | 'reactivate';
  note?: string; gazetteRef?: string; effectiveFrom?: string; effectiveTo?: string;
  titleAr?: string; titleEn?: string; textAr?: string; textEn?: string;
};

// POST /api/kb/audit/:id — Phase 0 verification actions. Lawyer-only (PRD 3.3):
// a licensed reviewer signs off each provision against the official gazette.
// verify      → mark verified with note + gazette ref + effective dates
// amend       → publish a corrected version (v+1, supersedes old; history retained)
// deactivate  → retire an entry that should not be cited at all
// reactivate  → undo a deactivation for further review
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'LAWYER') {
    return json({ error: 'Phase 0 verification is restricted to the LAWYER role' }, 403);
  }
  const { id } = await ctx.params;
  const provision = await getProvisionById(id);
  if (!provision) return notFound('provision');

  const body = await readJson<Body>(req);
  const action = body.action;
  const note = String(body.note ?? '').trim();

  if (action === 'verify') {
    if (!note) return json({ error: 'a verification note is required (basis for sign-off)' }, 400);
    const updated = await verifyProvision(id, {
      note,
      gazetteRef: body.gazetteRef?.trim() || undefined,
      effectiveFrom: body.effectiveFrom?.trim() || undefined,
      effectiveTo: body.effectiveTo?.trim() || undefined,
      verifiedBy: guard.ctx.uid, verifiedByName: guard.ctx.name ?? 'lawyer'
    });
    await audit('kb.audit.verify', `${provision.lawId} م${provision.articleNo} v${provision.version} → verified${body.gazetteRef ? ` (gazette: ${body.gazetteRef})` : ''}`, guard.ctx.orgId, guard.ctx.uid);
    return json({ ok: true, provision: updated });
  }

  if (action === 'amend') {
    const textAr = String(body.textAr ?? '').trim();
    const textEn = String(body.textEn ?? '').trim();
    if (!note) return json({ error: 'an amendment note is required' }, 400);
    if (!textAr && !textEn) return json({ error: 'amended text (ar and/or en) is required' }, 400);
    const { provision: amended, previous } = await amendProvision(id, {
      titleAr: body.titleAr, titleEn: body.titleEn,
      textAr: textAr || provision.textAr, textEn: textEn || provision.textEn,
      note, gazetteRef: body.gazetteRef?.trim() || undefined,
      effectiveFrom: body.effectiveFrom?.trim() || undefined,
      verifiedBy: guard.ctx.uid, verifiedByName: guard.ctx.name ?? 'lawyer'
    });
    await audit('kb.audit.amend', `${provision.lawId} م${provision.articleNo} v${provision.version} → v${amended?.version} (supersedes; history retained)`, guard.ctx.orgId, guard.ctx.uid);
    return json({ ok: true, provision: amended, previous });
  }

  if (action === 'deactivate') {
    if (!note) return json({ error: 'a deactivation reason is required' }, 400);
    const updated = await deactivateProvision(id, note, guard.ctx.name ?? 'lawyer');
    await audit('kb.audit.deactivate', `${provision.lawId} م${provision.articleNo} v${provision.version} → deactivated: ${note}`, guard.ctx.orgId, guard.ctx.uid);
    return json({ ok: true, provision: updated });
  }

  if (action === 'reactivate') {
    const updated = await reactivateProvision(id, guard.ctx.name ?? 'lawyer');
    await audit('kb.audit.reactivate', `${provision.lawId} م${provision.articleNo} v${provision.version} → reactivated for further review`, guard.ctx.orgId, guard.ctx.uid);
    return json({ ok: true, provision: updated });
  }

  return json({ error: 'unknown action — expected verify | amend | deactivate | reactivate' }, 400);

});
