import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getProvisionsByLaw, getAllProvisions, getAuditStats } from '@/lib/db';

// GET /api/kb/audit — Phase 0 citation-audit queue (PRD 3.3 / 6.3a).
// Readable by every signed-in member (transparency); verification actions
// are lawyer-only (see kb/audit/[id]). Returns provisions with full
// verification metadata + aggregate Phase 0 progress.
// ?includeArchived=1 also returns superseded/deactivated rows (history view).
//
// Task 13 (Verification UI): additive queue params — all optional, the bare
// response is byte-compatible with the pre-13 shape:
//   ?status=unverified|verified|archived   (default: no status filter)
//   ?q=<substring of articleNo / title / text>
//   ?limit=<1..200>  ?offset=<n>           (default: unpaginated full list)
// Response gains `filteredTotal` (count AFTER status/q filter, BEFORE paging)
// so the UI can paginate without over-fetching.
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const url = new URL(req.url);
  const law = url.searchParams.get('law') || undefined;
  const includeArchived = url.searchParams.get('includeArchived') === '1';
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 0, 0), 200);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const provisions = includeArchived ? await getAllProvisions(law) : await getProvisionsByLaw(law);
  const stats = await getAuditStats();

  let rows = provisions;
  if (status === 'unverified') rows = rows.filter(p => !p.verified);
  else if (status === 'verified') rows = rows.filter(p => p.verified);
  else if (status === 'archived') rows = rows.filter(p => !p.isActive);
  if (q) {
    rows = rows.filter(p =>
      String(p.articleNo).includes(q) ||
      (p.titleAr || '').includes(q) ||
      (p.textAr || '').includes(q)
    );
  }
  const filteredTotal = rows.length;
  const page = limit > 0 ? rows.slice(offset, offset + limit) : rows;

  return json({
    stats,
    phase0Complete: stats.total > 0 && stats.verified === stats.total,
    canVerify: guard.role === 'LAWYER',
    citationPolicy:
      'Phase 0: a licensed lawyer must audit every LKB provision against the official gazette before it can be presented as verified. Verification records who, when, and on what basis (PRD 6.3a).',
    filteredTotal,
    provisions: page
  });

});
