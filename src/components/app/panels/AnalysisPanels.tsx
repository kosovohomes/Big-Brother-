'use client';

// Analysis panels — Layer 1 educational outputs (default view, PRD 5.5 AC6):
//   AlertsPanel: neutral procedural alerts + feedback loop (5.3 AC3)
//   GroundsPanel: ALL ground categories with relevance indicators + the
//     non-dismissible banner on every view (5.5 AC2/AC3) — no draft here;
//     the discussion draft lives behind an explicit action in DraftsPanel.
//   CounterPanel: educational breakdown of the opponent pleading (5.6 AC1-2).

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ThumbsUp, ThumbsDown, HelpCircle, FileSearch } from 'lucide-react';
import { api } from '../api';
import { tr, T, type Lang } from '../i18n';
import { CitationBadge, GroundBanner, type Citation } from '../compliance';
import type { AlertItem, GroundItem, AssertionResponse, Relevance, Severity } from '@/lib/types';

const SEV_STYLE: Record<Severity, string> = {
  high: 'border-red-200 bg-red-50/70 text-red-900',
  medium: 'border-amber-200 bg-amber-50/70 text-amber-900',
  low: 'border-slate-200 bg-slate-50 text-slate-700'
};
const REL_BADGE: Record<Relevance, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-600'
};

export function AlertsPanel({
  lang, caseId, alerts, onFeedback
}: {
  lang: Lang; caseId: string; alerts: AlertItem[];
  onFeedback: (targetId: string, value: 'helpful' | 'not_helpful' | 'needs_facts') => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {lang === 'ar'
          ? 'تنبيهات محايدة الصياغة لما «قد» يكون غير منضبط إجرائيًا — للنقاش مع محامٍ، وليست حكمًا.'
          : 'Neutral wording for potential irregularities — for discussion with a lawyer, not determinations.'}
      </p>
      {alerts.map(a => (
        <Card key={a.id} className={SEV_STYLE[a.severity]} data-testid={`alert-${a.id}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">{tr(T.severity[a.severity], lang)} — {lang === 'ar' ? 'ملاحظة إنذارية' : 'Informational flag'}</CardTitle>
              <Badge variant="outline" className="bg-white">{a.ruleId}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="leading-7">{lang === 'ar' ? a.ar : a.en}</p>
            <div className="flex flex-wrap gap-1.5">
              {a.citations?.map((c, i) => <CitationBadge key={i} c={c as Citation} lang={lang} />)}
            </div>
            {a.evidence && <p className="rounded bg-white/70 p-2 text-xs text-slate-600" dir="auto">{lang === 'ar' ? 'المؤشر: ' : 'Trigger: '}{a.evidence}</p>}
            <FeedbackRow lang={lang} onValue={v => { onFeedback(a.id, v); }} />
          </CardContent>
        </Card>
      ))}
      {alerts.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">{lang === 'ar' ? 'لا تنبيهات إجرائية حاليًا.' : 'No procedural alerts currently.'}</CardContent></Card>}
      void caseId;
    </div>
  );
}

export function GroundsPanel({
  lang, grounds, filters
}: {
  lang: Lang; grounds: GroundItem[]; filters?: { severity?: string };
}) {
  const [filter, setFilter] = useState<'all' | Relevance>('all');
  const shown = grounds.filter(g => filter === 'all' || g.relevance === filter);
  return (
    <div className="space-y-3">
      <GroundBanner lang={lang} />
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'high', 'medium', 'low'] as const).map(v => (
          <Badge
            key={v}
            variant={filter === v ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setFilter(v)}
            data-testid={`ground-filter-${v}`}
          >
            {v === 'all' ? (lang === 'ar' ? 'الكل' : 'All') : tr(T.relevance[v], lang)}
          </Badge>
        ))}
      </div>
      {shown.map(g => (
        <Card key={g.id} data-testid={`ground-${g.ruleId}`}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold" dir="auto">{lang === 'ar' ? g.rule?.ar : g.rule?.en}</CardTitle>
              <Badge className={REL_BADGE[g.relevance]}>{tr(T.relevance[g.relevance], lang)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid gap-1 text-xs text-slate-600">
              <div><span className="font-semibold">{lang === 'ar' ? 'الوسيلة الإجرائية المعتادة: ' : 'Typical procedural vehicle: '}</span>{tr(g.rule?.vehicle || { ar: '', en: '' }, lang)}</div>
              <div><span className="font-semibold">{lang === 'ar' ? 'التوقيت المعتاد: ' : 'Typical timing: '}</span>{tr(g.rule?.timing || { ar: '', en: '' }, lang)}</div>
            </div>
            {g.satisfiedPredicates?.length > 0 && (
              <ul className="list-inside list-disc text-xs text-slate-600">
                {g.satisfiedPredicates.map((p, i) => <li key={i} dir="auto">{p}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              {g.citations?.map((c, i) => <CitationBadge key={i} c={c as Citation} lang={lang} />)}
            </div>
            <Separator />
            <p className="text-xs leading-6 text-muted-foreground">
              {lang === 'ar'
                ? 'هذه فئة تعليمية تشرح ما تتطلبه القاعدة عادةً — لا نجزم بأنها تنطبق على قضيتك. لتوليد مسودة نقاش خاصة بقضيتك انتقل إلى «مسودات النقاش» وهي خطوة صريحة منفصلة.'
                : 'This is an educational category explaining what the rule generally requires — we never assert it applies to your case. To generate a case-specific discussion draft, use the explicit step in “Discussion Drafts”.'}
            </p>
          </CardContent>
        </Card>
      ))}
      void filters;
    </div>
  );
}

export function CounterPanel({
  lang, breakdown, onSavePleading, hasPleading
}: {
  lang: Lang;
  breakdown: { assertions: { id: number; text: string; kind: string }[]; responses: AssertionResponse[] } | null;
  onSavePleading: (text: string) => void;
  hasPleading: boolean;
}) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{lang === 'ar' ? 'نص مذكرة الخصم' : "Opponent's pleading text"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={4} value={text} onChange={e => setText(e.target.value)}
            placeholder={lang === 'ar' ? 'الصق نص مذكرة الخصم هنا…' : 'Paste the pleading text…'} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { onSavePleading(text); }} disabled={!text.trim()} data-testid="pleading-save">
              <FileSearch className="ms-1 h-4 w-4" /> {lang === 'ar' ? 'حفظ وتحليل تعليمي' : 'Save & analyze'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasPleading && breakdown && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{lang === 'ar' ? 'التفكيك التعليمي — الفئة الافتراضية (طبقة 1)' : 'Educational breakdown — default layer (Layer 1)'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs leading-6 text-muted-foreground">
              {lang === 'ar'
                ? 'لكل مطلب/ادعاء نعرض فئات الرد العامة الممكنة (إنكار / إنكار مقيّد / مناقشة) وأسسها القانونية العامة — معلومات توضيحية وليست تحديدًا لموقفك.'
                : 'For each assertion we show the general response categories available and their general legal bases — illustrative information, not a determination of your position.'}
            </p>
            {breakdown.responses.map(r => (
              <div key={r.assertionId} className="rounded-lg border p-3 text-sm" data-testid={`assertion-${r.assertionId}`}>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" dir="auto">#{r.assertionId} · {r.kind}</Badge>
                  <Badge variant={r.verified === 'partial' ? 'secondary' : 'outline'} className="border-amber-300 text-amber-800">
                    {r.verified === 'partial' ? (lang === 'ar' ? 'تغطية جزئية' : 'partial') : (lang === 'ar' ? 'يتطلب مراجعة' : 'needs review')}
                  </Badge>
                </div>
                <p className="mt-2 leading-7" dir="auto">{lang === 'ar' ? r.assertion : r.assertion}</p>
                <Separator className="my-2" />
                <div className="grid gap-1 text-xs">
                  <div><span className="font-semibold">{lang === 'ar' ? 'فئة الموقف: ' : 'Position: '}</span>{tr(r.position, lang)}</div>
                  <div dir="auto"><span className="font-semibold">{lang === 'ar' ? 'الأساس العام: ' : 'General basis: '}</span>{tr(r.basis, lang)}</div>
                  <div><span className="font-semibold">{lang === 'ar' ? 'فئة الطلب: ' : 'Relief category: '}</span>{tr(r.relief, lang)}</div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {r.articles.map((a, i) => <Badge key={i} variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{a} · {lang === 'ar' ? 'غير مُتحقق' : 'unverified'}</Badge>)}
                  </div>
                </div>
              </div>
            ))}
            {breakdown.responses.length === 0 && (
              <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لم نتمكن من عزل ادعاءات واضحة — أضف نصًا أطول.' : 'No clear assertions isolated — add longer text.'}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FeedbackRow({ lang, onValue }: { lang: Lang; onValue: (v: 'helpful' | 'not_helpful' | 'needs_facts') => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-xs text-slate-500">{tr(T.helpNotHelpful, lang)}:</span>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => onValue('helpful')}><ThumbsUp className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => onValue('not_helpful')}><ThumbsDown className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onValue('needs_facts')}>
        <HelpCircle className="h-3.5 w-3.5" /> {lang === 'ar' ? 'يحتاج وقائع أكثر' : 'Needs more facts'}
      </Button>
    </div>
  );
}
