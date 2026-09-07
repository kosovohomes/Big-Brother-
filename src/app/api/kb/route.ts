import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getProvisionsByLaw } from '@/lib/db';

// GET /api/kb?law=51/1996&q=... — Legal Knowledge Base browser (PRD §6.3a).
// The LKB is the sole source of truth for citations; entries carry
// verification status + version history (superseded rows retained).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const law = new URL(req.url).searchParams.get('law') || undefined;
  const provisions = await getProvisionsByLaw(law);
  const byLaw: Record<string, number> = {};
  for (const p of provisions) byLaw[p.lawId] = (byLaw[p.lawId] || 0) + 1;
  return json({
    total: provisions.length,
    byLaw,
    verifiedCount: provisions.filter(p => p.verified).length, // 0 until Phase 0 audit
    provisions
  });

});
