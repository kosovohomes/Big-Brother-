import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { findProvision, getAllActiveProvisions } from '@/lib/db';

// GET /api/kb/resolve?law=38/1980&article=163 — citation validator (PRD §6.3).
// Resolves a candidate citation to an exact LKB entry or reports unresolved.
// Unresolved candidates are NEVER displayed as citations (hallucination guard).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const url = new URL(req.url);
  const law = url.searchParams.get('law') || '';
  const article = url.searchParams.get('article') || '';
  if (!law || !article) return json({ error: 'law and article are required' }, 400);

  const norm = (s: string) => s.replace(/[–—−]/g, '-').replace(/\s+/g, '').toLowerCase();
  const exact = await findProvision(law, article);
  let match = exact[0] || null;
  let matchType: 'exact' | 'range' | 'unresolved' = exact.length ? 'exact' : 'unresolved';
  if (!match) {
    const all = (await getAllActiveProvisions()).filter(p => p.lawId === law);
    const a = norm(article);
    const ranged = all.find(p => norm(p.articleNo).split('-').some(part => a.includes(part)));
    if (ranged) { match = ranged; matchType = 'range'; }
  }

  if (!match) {
    return json({
      resolved: false,
      displayRule: 'unresolved — never shown as a citation; flag as "unverified — human review required" (PRD 6.3/6.3a)',
      query: { law, article }
    });
  }
  return json({
    resolved: true,
    matchType,
    verified: match.verified, // false until Phase 0 sign-off
    label: match.verified ? 'verified' : 'unverified — pending Phase 0 citation audit',
    provision: match
  });

});
