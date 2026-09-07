import { NextRequest } from 'next/server';
import { json, requireOrg, withOrg } from '@/lib/api-helpers';
import { flags } from '@/lib/config';
import { ragCtx } from '@/lib/rag/server-ctx';

// GET /api/rag/search?q=&law=&limit=&asOf=&versions= — RAG retrieval (the
// PROPOSER layer, RAG_SPEC §4.2/§4.3). Hits are retrieval proposals ONLY:
// they are never citations. Consumers (see the RelatedLaws panel) resolve
// {lawId, articleNo} through /api/kb/resolve before any citation display,
// and every hit carries its verified flag + provisional-source provenance.
export const GET = withOrg(async function (req: NextRequest) {
  if (!flags.ragEnabled()) return json({ error: 'rag_disabled' }, 503);
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;

  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const law = url.searchParams.get('law') || undefined;
  const limit = Number(url.searchParams.get('limit')) || 8;
  const asOf = url.searchParams.get('asOf') || undefined;
  const versions = (url.searchParams.get('versions') || 'current') as 'current' | 'historical' | 'all';

  const { ragSearch } = await import('@/lib/rag/retriever.mjs');
  const ctx = await ragCtx();
  const out = await ragSearch(ctx, {
    q, lawId: law, limit, asOf, versions,
    orgId: guard.ctx.orgId // attribution only — query TEXT is never persisted
  });
  return json(out);
});
