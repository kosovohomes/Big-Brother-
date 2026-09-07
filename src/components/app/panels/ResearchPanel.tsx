/* eslint-disable react-hooks/set-state-in-effect -- data-fetch-on-mount pattern; setState occurs in async continuations */
'use client';

// Legal Knowledge Base browser (PRD 6.3a): structured, versioned, human-curated
// provisions as the sole citation source; Arabic-first search with the
// definite-article fix; every entry shows its verification status; citation
// resolver demonstrates the hallucination guard.

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ShieldAlert, ShieldCheck, Globe } from 'lucide-react';
import { api } from '../api';
import { tr, T, type Lang } from '../i18n';
import { CitationBadge, type Citation } from '../compliance';

export interface ProvisionRow {
  id: string; lawId: string; lawNameAr: string; lawNameEn: string; articleNo: string;
  titleAr: string; titleEn: string; textAr: string; textEn: string;
  summaryAr: string; summaryEn: string; topics: string[];
  verified: boolean; verificationNote?: string; version: number; gazetteRef?: string;
}

export function ResearchPanel({ lang }: { lang: Lang }) {
  const [q, setQ] = useState('');
  const [law, setLaw] = useState<string>('all');
  const [rows, setRows] = useState<ProvisionRow[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [stats, setStats] = useState<{ total: number; verified: number; byLaw: Record<string, number> } | null>(null);
  const [resolveLaw, setResolveLaw] = useState('38/1980');
  const [resolveArticle, setResolveArticle] = useState('163');
  const [resolved, setResolved] = useState<Record<string, unknown> | null>(null);

  const load = async (query = '', lawFilter?: string) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (lawFilter && lawFilter !== 'all') params.set('law', lawFilter);
    const res = await api.get(`/api/search?${params.toString()}&limit=12`) as { results: ProvisionRow[]; normalizedTokens: string[] };
    setRows(res.results); setTokens(res.normalizedTokens || []);
  };
  useEffect(() => { load('', law); api.get('/api/kb/stats').then(setStats).catch(() => null); }, [law]);

  const resolve = async () => {
    const res = await api.get(`/api/kb/resolve?law=${encodeURIComponent(resolveLaw)}&article=${encodeURIComponent(resolveArticle)}`);
    setResolved(res);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{lang === 'ar' ? 'البحث في قاعدة المعرفة (المصدر الوحيد للاستشهادات)' : 'Knowledge Base search (the sole citation source)'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-56 flex-1" value={q} onChange={e => setQ(e.target.value)}
              placeholder={tr(T.search, lang)} onKeyDown={e => { if (e.key === 'Enter') load(q, law); }} data-testid="kb-search" />
            <Select value={law} onValueChange={setLaw}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{lang === 'ar' ? 'كل القوانين' : 'All laws'}</SelectItem>
                <SelectItem value="38/1980">38/1980 — مرافعات</SelectItem>
                <SelectItem value="17/1960">17/1960 — إجراءات جزائية</SelectItem>
                <SelectItem value="51/1996">51/1996 — أحوال شخصية</SelectItem>
                <SelectItem value="16/1960">16/1960 — جزاء</SelectItem>
                <SelectItem value="9/2020">9/2020 — تبليغات إلكترونية</SelectItem>
                <SelectItem value="67/1976">67/1976 — قانون مدني</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => load(q, law)} data-testid="kb-search-btn"><Search className="ms-1 h-4 w-4" /></Button>
          </div>
          {tokens.length > 0 && (
            <p className="text-xs text-muted-foreground" dir="ltr">
              {lang === 'ar' ? 'التطبيع: ' : 'Normalized tokens: '}{tokens.join(' · ')}
            </p>
          )}
          {stats && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">{stats.total} {lang === 'ar' ? 'مادة' : 'provisions'}</Badge>
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                {lang === 'ar' ? `مُتحقق: ${stats.verified} — بانتظار تدقيق المرحلة صفر` : `verified: ${stats.verified} — Phase 0 audit pending`}
              </Badge>
              <Badge variant="outline" className="gap-1"><ShieldAlert className="h-3 w-3" /> {lang === 'ar' ? 'كل الاستشهادات تعرض حالة التحقق' : 'every citation displays its verification status'}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map(p => (
          <Card key={p.id} data-testid={`provision-${p.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm" dir="auto">{lang === 'ar' ? p.titleAr : p.titleEn}</CardTitle>
                {p.verified
                  ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800"><ShieldCheck className="h-3 w-3" /> {tr(T.verified, lang)}</Badge>
                  : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800"><ShieldAlert className="h-3 w-3" /> {tr(T.unverified, lang)}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="secondary">{p.lawId} · م {p.articleNo}</Badge>
                <Badge variant="outline">v{p.version}</Badge>
                {p.gazetteRef && <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" /> كويت اليوم</Badge>}
                {p.topics.map(t => <Badge key={t} variant="outline">{t}</Badge>)}
              </div>
              <p className="leading-7" dir="rtl">{p.textAr}</p>
              <p className="text-xs leading-6 text-muted-foreground" dir="ltr">{p.textEn}</p>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && <Card className="lg:col-span-2"><CardContent className="py-8 text-center text-sm text-muted-foreground">{lang === 'ar' ? 'لا نتائج — جرّب كلمة أخرى.' : 'No results — try another query.'}</CardContent></Card>}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{lang === 'ar' ? 'مُتحقّق الاستشهادات (حاجز الهلوسة)' : 'Citation resolver (hallucination guard)'}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs leading-6 text-muted-foreground">
            {lang === 'ar'
              ? 'يجب أن يُحلّ أي استشهاد إلى مادة محددة في قاعدة المعرفة قبل عرضه؛ ما لا يُحلّ يُعرض دائمًا كـ«غير مُتحقق — لا يُعرض كاستشهاد».'
              : 'Any citation must resolve to an exact LKB entry before display; unresolved candidates are always shown as “unverified — not shown as a citation”.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input className="w-36" dir="ltr" value={resolveLaw} onChange={e => setResolveLaw(e.target.value)} />
            <Input className="w-28" dir="ltr" value={resolveArticle} onChange={e => setResolveArticle(e.target.value)} />
            <Button size="sm" variant="outline" onClick={resolve} data-testid="resolve-btn">resolve</Button>
          </div>
          {resolved && (
            <div className="rounded-lg border bg-slate-50 p-3 text-xs">
              <CitationBadge
                c={{
                  ref: { lawId: resolveLaw, article: resolveArticle, ar: '', en: '' },
                  resolved: !!(resolved as { resolved?: boolean }).resolved,
                  verified: !!(resolved as { verified?: boolean }).verified,
                  label: (resolved as { label?: string }).label || ''
                } as Citation}
                lang={lang}
              />
              {resolved.matchType && <span className="ms-2">{String(resolved.matchType)}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
