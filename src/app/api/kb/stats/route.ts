import { NextRequest } from 'next/server';
import { json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getKbStatsByLaw } from '@/lib/db';

// GET /api/kb/stats — corpus composition + verification status.
// (Raw SQLite SQL moved into the facade in Phase A — C-A5/C-R6 pattern.)
export const GET = withOrg(async function (req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const stats = await getKbStatsByLaw();
  return json({
    total: stats.total, byLaw: stats.byLaw, verified: stats.verified,
    citationPolicy: 'All citations resolve to the structured Legal Knowledge Base (PRD 6.3a). Entries are shown with an unverified flag until the Phase 0 citation audit completes.'
  });
});
