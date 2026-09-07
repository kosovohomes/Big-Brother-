import { NextRequest } from 'next/server';
import { json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getAuditStats } from '@/lib/db';
import { flags } from '@/lib/config';
import { ragCtx } from '@/lib/rag/server-ctx';

// GET /api/rag/status — corpus coverage per law, ingest jobs, Phase 0
// progress parity (RAG_SPEC §4.4). Readable by any authenticated member.
export const GET = withOrg(async function (req: NextRequest) {
  if (!flags.ragEnabled()) return json({ error: 'rag_disabled' }, 503);
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;

  const ctx = await ragCtx();
  const { ensureRagSchema, getCoverage, getJobs, getRagTotals, BLOCKED_LAWS } = await import('@/lib/rag/store.mjs');
  await ensureRagSchema(ctx);

  const [coverage, jobs, totals] = await Promise.all([
    getCoverage(ctx), getJobs(ctx, 25), getRagTotals(ctx)
  ]);
  const phase0 = await getAuditStats();

  return json({
    backend: ctx.dialect,
    embedConfigured: !!(process.env.RAG_OLLAMA_HOST || ''),
    totals,
    coverage,
    jobs: jobs.map((j) => ({
      id: j.id, issueNo: j.issue_no, publishDate: j.publish_date, sourcePath: j.source_path,
      status: j.status, attested: !!Number(j.attested), stats: (() => { try { return JSON.parse(j.stats || '{}'); } catch { return {}; } })(),
      createdAt: j.created_at
    })),
    phase0: { total: phase0.total, verified: phase0.verified, pending: phase0.pending },
    blocklist: [...BLOCKED_LAWS],
    citationPolicy:
      'RAG hits are retrieval proposals, never citations. LegalProvision stays the sole citation source; every hit is resolved through resolveRef and badged with its verification state.'
  });
});
