import { NextRequest } from 'next/server';
import {json, requireOrg, withOrg } from '@/lib/api-helpers';
import { getAllActiveProvisions } from '@/lib/db';
import { buildIndex, bm25Score, tokenize } from '@/lib/arabic';

// GET /api/search?q=&law=&topic=&limit= — BM25 over the Legal Knowledge Base.
// Arabic-first retrieval with definite-article stripping and light stemming:
// "تزوير" now matches "التزوير" (v0.1 recall bug fixed).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const law = url.searchParams.get('law') || undefined;
  const topic = url.searchParams.get('topic') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 8, 25);

  const provisions = await getAllActiveProvisions();
  const docs = provisions.map(p => ({
    ...p,
    indexText: `${p.lawNameAr} مادة ${p.articleNo} ${p.titleAr} ${p.textAr} ${p.summaryAr} ${p.topics.join(' ')} ${p.lawId} ${p.lawNameEn} ${p.titleEn} ${p.textEn} ${p.summaryEn}`
  }));
  const idx = buildIndex(docs, d => d.indexText);

  let pool = idx.docs;
  if (law) pool = pool.filter(d => d.lawId === law);
  if (topic) pool = pool.filter(d => d.topics.includes(topic));

  const qTokens = tokenize(q);
  const scored = pool
    .map(d => ({ d, score: qTokens.length ? bm25Score(qTokens, d.tokens, idx.df, idx.N, idx.avgdl) : 1 }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d, score }) => ({
      id: d.id, lawId: d.lawId, lawNameAr: d.lawNameAr, lawNameEn: d.lawNameEn,
      articleNo: d.articleNo, titleAr: d.titleAr, titleEn: d.titleEn,
      textAr: d.textAr, textEn: d.textEn, summaryAr: d.summaryAr, summaryEn: d.summaryEn,
      topics: d.topics, verified: d.verified, verificationNote: d.verificationNote,
      gazetteRef: d.gazetteRef, version: d.version,
      score: Math.round(score * 100) / 100
    }));

  return json({
    query: q,
    normalizedTokens: qTokens, // transparency: show how the query was normalized
    total: pool.length,
    results: scored
  });

});
