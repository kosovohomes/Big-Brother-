'use client';

// Related-laws panel (RAG Phase 1 consumer, harness step 6): proves the
// retrieval pipeline is reachable end-to-end from the case view.
//
// Consumption contract (docs/RAG_SPEC.md §4.3 — the anti-hallucination
// guarantee is unchanged): every hit is a RETRIEVAL PROPOSAL, never a
// citation. A hit only becomes a citable reference after it resolves
// through /api/kb/resolve (the LegalProvision LKB), and until a lawyer
// verifies it in Phase 0 it renders with the unverified badge — same
// styling and rule as every other unverified citation in the app.

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldAlert, ShieldCheck, Search, Info } from 'lucide-react';
import { api } from '../api';
import { type Lang } from '../i18n';
import { CitationBadge, type Citation } from '../compliance';

interface RagHit {
  chunkId: string;
  provisionId: string | null;
  lawId: string;
  articleNo: string;
  articlePart: number;
  version: number | null;
  snippet: string;
  score: number;
  verified: boolean;
  chunkStatus: string;
  provisionalSource: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

interface ResolveResult {
  resolved?: boolean;
  verified?: boolean;
  label?: string;
  provision?: { id?: string; textAr?: string };
}

export function RelatedLaws({ lang, caseId, query }: { lang: Lang; caseId: string; query: string }) {
  const [hits, setHits] = useState<RagHit[]>([]);
  const [meta, setMeta] = useState<{ embedMode?: string; total?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<Record<string, ResolveResult | null>>({});

  const load = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setResolved({});
    try {
      const res = await api.get(`/api/rag/search?q=${encodeURIComponent(q)}&limit=5`) as { results: RagHit[]; meta?: { embedMode: string; total: number } };
      setHits(res.results || []);
      setMeta(res.meta || null);
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (query) load(query); }, [caseId, query, load]);

  // The proposer→resolver step: a hit becomes a citable reference only after
  // /api/kb/resolve re-reads the LKB (resolveRef). Unresolved/unverified hits
  // keep the amber "not shown as a citation" badge (PRD 6.3).
  const resolveHit = async (hit: RagHit) => {
    try {
      const r = await api.get(`/api/kb/resolve?law=${encodeURIComponent(hit.lawId)}&article=${encodeURIComponent(hit.articleNo)}`) as ResolveResult;
      setResolved(prev => ({ ...prev, [hit.chunkId]: r }));
    } catch {
      setResolved(prev => ({ ...prev, [hit.chunkId]: { resolved: false, verified: false, label: lang === 'ar' ? 'غير مُتحقق' : 'unverified' } }));
    }
  };

  return (
    <Card data-testid="related-laws">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="h-4 w-4" />
          {lang === 'ar' ? 'قوانين ذات صلة (اقتراحات استرجاع — ليست استشهادات)' : 'Related laws (retrieval proposals — not citations)'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-6 text-muted-foreground">
          <Info className="ms-1 inline h-3 w-3" />
          {lang === 'ar'
            ? 'تُستخرج هذه النتائج آليًا من نصوص القوانين (RAG). لا تُعد استشهادًا إلا بعد التحقق عبر قاعدة المعرفة، وما لم يُتحقق منه يظهر دائمًا بعلامة «غير مُتحقق».'
            : 'These results are retrieved automatically from the law corpus (RAG). Nothing is a citation until it resolves through the Knowledge Base; unverified hits always carry the amber badge.'}
        </p>

        {meta && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{lang === 'ar' ? `نمط الاسترجاع: ${meta.embedMode === 'hybrid' ? 'هجين' : meta.embedMode === 'dense' ? 'تضمين' : 'نصي (BM25)'}` : `retrieval: ${meta.embedMode}`}</Badge>
            {typeof meta.total === 'number' && <Badge variant="outline">{meta.total} {lang === 'ar' ? 'مُرشّح' : 'candidates'}</Badge>}
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'جارٍ الاسترجاع…' : 'Retrieving…'}</p>}

        <div className="space-y-2">
          {hits.map(hit => {
            const res = resolved[hit.chunkId];
            const r = res
              ? res.resolved
                ? { ref: { lawId: hit.lawId, article: hit.articleNo, ar: '', en: '' }, resolved: true, verified: !!res.verified, label: res.label || '' }
                : { ref: { lawId: hit.lawId, article: hit.articleNo, ar: '', en: '' }, resolved: false, verified: false, label: res.label || '' }
              : null;
            return (
              <div key={hit.chunkId} className="rounded-lg border p-3 space-y-2" data-testid={`rag-hit-${hit.lawId}-${hit.articleNo}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="secondary" dir="auto">{hit.lawId} · م {hit.articleNo}{hit.articlePart > 1 ? ` (${hit.articlePart})` : ''}</Badge>
                  {hit.verified
                    ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800"><ShieldCheck className="h-3 w-3" /> {lang === 'ar' ? 'مُتحقق' : 'verified'}</Badge>
                    : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800"><ShieldAlert className="h-3 w-3" /> {lang === 'ar' ? 'غير مُتحقق منه' : 'unverified'}</Badge>}
                  {hit.provisionalSource && (
                    <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">
                      {lang === 'ar' ? 'مصدر مرآة مؤقت' : 'provisional mirror source'}
                    </Badge>
                  )}
                  {hit.effectiveTo && (
                    <Badge variant="outline">{lang === 'ar' ? `نسخة تاريخية (حتى ${String(hit.effectiveTo).slice(0, 10)})` : `historical (until ${String(hit.effectiveTo).slice(0, 10)})`}</Badge>
                  )}
                  <span className="text-muted-foreground" dir="ltr">score {hit.score}</span>
                </div>
                <p className="text-sm leading-7" dir="rtl">{hit.snippet}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => resolveHit(hit)} data-testid={`rag-resolve-${hit.articleNo}`}>
                    {lang === 'ar' ? 'تحقق من الاستشهاد عبر قاعدة المعرفة' : 'Resolve through the LKB'}
                  </Button>
                  {r && <CitationBadge c={r as Citation} lang={lang} />}
                </div>
              </div>
            );
          })}
          {!loading && hits.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {lang === 'ar' ? 'لا اقتراحات بعد — استرجاع RAG لم يُغطِّ هذا النص.' : 'No proposals yet — RAG retrieval returned nothing for this case text.'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
