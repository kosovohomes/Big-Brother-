'use client';

// Citation Audit panel — the Phase 0 workflow (PRD 3.3 / 6.3a).
// Transparency: every signed-in member sees the queue and its progress.
// Actions (verify / amend / deactivate / reactivate) are LAWYER-only and are
// enforced server-side; each action records who, when, and on what basis.

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, ShieldX, Archive, Globe, Gavel, History } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { toast } from '@/hooks/use-toast';

interface Provision {
  id: string; lawId: string; lawNameAr: string; lawNameEn: string; articleNo: string;
  amendmentVersion: string; effectiveFrom?: string; effectiveTo?: string; gazetteRef?: string;
  titleAr: string; titleEn: string; textAr: string; textEn: string;
  verified: boolean; verificationNote?: string; verifiedBy?: string; verifiedAt?: string;
  version: number; supersedesId?: string; isActive: boolean;
}
interface AuditStats {
  total: number; verified: number; pending: number; superseded: number;
  byLaw: Record<string, { total: number; verified: number }>;
}
interface QueueResponse {
  stats: AuditStats; phase0Complete: boolean; canVerify: boolean; provisions: Provision[];
}
type ActionChoice = 'verify' | 'amend' | 'deactivate';

const LAWS = [
  { id: '38/1980', ar: 'مرافعات 38/1980' },
  { id: '17/1960', ar: 'إجراءات جزائية 17/1960' },
  { id: '51/1996', ar: 'أحوال شخصية 51/1996' },
  { id: '16/1960', ar: 'جزاءات 16/1960' },
  { id: '35/1978', ar: 'إيجارات 35/1978' },
  { id: '67/1980', ar: 'قانون مدني 67/1980' },
  { id: '67/1976', ar: 'قانون مدني؟ صف تجريبي 67/1976' },
  { id: '9/2020', ar: 'تبليغات إلكترونية 9/2020' }
];

export function AuditPanel({ lang }: { lang: Lang }) {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [law, setLaw] = useState('all');
  const [status, setStatus] = useState<'all' | 'pending' | 'verified'>('all');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [choice, setChoice] = useState<ActionChoice>('verify');
  const [note, setNote] = useState('');
  const [gazetteRef, setGazetteRef] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [textAr, setTextAr] = useState('');
  const [textEn, setTextEn] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (law !== 'all') params.set('law', law);
      if (showArchived) params.set('includeArchived', '1');
      const res = await api.get(`/api/kb/audit?${params.toString()}`) as unknown as QueueResponse;
      setQueue(res);
    } catch { setQueue(null); }
  }, [law, showArchived]);
  useEffect(() => { load(); }, [load]);

  const openReview = (p: Provision) => {
    setOpenId(p.id === openId ? null : p.id);
    setChoice('verify');
    setNote(''); setGazetteRef(p.gazetteRef || ''); setEffectiveFrom(p.effectiveFrom || '');
    setTextAr(p.textAr); setTextEn(p.textEn);
  };

  const submit = async (p: Provision) => {
    if (!note.trim() && choice !== 'reactivate') {
      toast({ title: lang === 'ar' ? 'أساس التوثيق إلزامي' : 'A review note is required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/kb/audit/${p.id}`, {
        action: choice, note, gazetteRef: gazetteRef || undefined,
        effectiveFrom: effectiveFrom || undefined, textAr, textEn
      });
      toast({
        title:
          choice === 'verify' ? (lang === 'ar' ? 'وُثّقت المادة وسُجّل الأساس' : 'Provision verified, basis recorded')
          : choice === 'amend' ? (lang === 'ar' ? 'نُشر إصدار مُعدّل وأُحفظ السجل' : 'Amended version published, history retained')
          : (lang === 'ar' ? 'أُوقفت المادة وسُجّل السبب' : 'Provision deactivated, reason recorded')
      });
      setOpenId(null); setNote('');
      await load();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const reactivate = async (p: Provision) => {
    setBusy(true);
    try {
      await api.post(`/api/kb/audit/${p.id}`, { action: 'reactivate' });
      toast({ title: lang === 'ar' ? 'أُعيدت المادة للمراجعة' : 'Provision reactivated for review' });
      await load();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const stats = queue?.stats;
  const pct = stats && stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0;
  const needle = q.trim().toLowerCase();
  const rows = (queue?.provisions || []).filter(p => {
    if (status === 'pending' && p.verified) return false;
    if (status === 'verified' && !p.verified) return false;
    if (!needle) return true;
    return `${p.titleAr} ${p.titleEn} ${p.textAr} ${p.textEn} ${p.articleNo}`.toLowerCase().includes(needle);
  });
  // The corpus now carries the full mirror texts of three real laws (900+ rows);
  // render a bounded slice so the DOM stays fast — filters/search narrow it down.
  const MAX_RENDER = 80;
  const visible = rows.slice(0, MAX_RENDER);

  return (
    <div className="space-y-4">
      {/* Task 13: dedicated paginated review screen (handles the 2100+ row queue) */}
      <div className="flex justify-end">
        <a href="/verification" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md border bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-muted">
          <Gavel className="h-3.5 w-3.5" />
          {lang === 'ar' ? 'شاشة التدقيق المخصصة (صفحات، بحث خادمي)' : 'Dedicated review screen (paginated, server-side search)'}
        </a>
      </div>
      <Card data-testid="audit-progress">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Gavel className="h-4 w-4" /> {tr(T.auditQueue, lang)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-6 text-muted-foreground">{tr(T.auditExplain, lang)}</p>
          {stats && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-2xl font-bold tabular-nums" dir="ltr" data-testid="audit-pct">{pct}%</div>
                <div className="flex-1"><Progress value={pct} /></div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                    {lang === 'ar' ? `مُوثّق: ${stats.verified}` : `verified: ${stats.verified}`}
                  </Badge>
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                    {lang === 'ar' ? `بانتظار المراجعة: ${stats.pending}` : `pending: ${stats.pending}`}
                  </Badge>
                  <Badge variant="outline" className="gap-1"><Archive className="h-3 w-3" /> {lang === 'ar' ? `مؤرشف: ${stats.superseded}` : `archived: ${stats.superseded}`}</Badge>
                </div>
              </div>
              {queue?.phase0Complete && (
                <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="phase0-complete">
                  <ShieldCheck className="me-1 inline h-4 w-4" /> {tr(T.auditPhase0Done, lang)}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {Object.entries(stats.byLaw).map(([id, s]) => (
                  <Badge key={id} variant="secondary" dir="ltr" className="gap-1">
                    {id}: {s.verified}/{s.total}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Input className="min-w-48 flex-1" value={q} onChange={e => setQ(e.target.value)}
            placeholder={lang === 'ar' ? 'ابحث في الطابور…' : 'Filter the queue…'} data-testid="audit-filter" />
          <Select value={law} onValueChange={setLaw}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === 'ar' ? 'كل القوانين' : 'All laws'}</SelectItem>
              {LAWS.map(l => <SelectItem key={l.id} value={l.id}>{l.ar}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={v => setStatus(v as 'all' | 'pending' | 'verified')}>
            <SelectTrigger className="w-40" data-testid="audit-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === 'ar' ? 'كل الحالات' : 'All statuses'}</SelectItem>
              <SelectItem value="pending">{lang === 'ar' ? 'بانتظار المراجعة' : 'Pending'}</SelectItem>
              <SelectItem value="verified">{lang === 'ar' ? 'مُوثّق' : 'Verified'}</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showArchived} onCheckedChange={c => setShowArchived(c === true)} data-testid="audit-archived" />
            {tr(T.auditArchivedToggle, lang)}
          </label>
        </CardContent>
      </Card>

      {!queue?.canVerify && (
        <p className="rounded-lg border border-dashed bg-white p-3 text-xs text-muted-foreground">
          {lang === 'ar'
            ? 'عرض للقراءة فقط: إجراءات التوثيق متاحة لدور «محامٍ» مرخّص (سجل التدقيق يثبت كل إجراء).'
            : 'Read-only view: verification actions are available to the licensed LAWYER role (every action is written to the audit trail).'}
        </p>
      )}

      <div className="space-y-3">
        {visible.map(p => (
          <Card key={p.id} data-testid={`audit-${p.id}`} className={p.isActive ? '' : 'opacity-70'}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-sm" dir="auto">{lang === 'ar' ? p.titleAr : p.titleEn}</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  {p.isActive
                    ? (p.verified
                      ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800"><ShieldCheck className="h-3 w-3" /> {tr(T.verified, lang)}</Badge>
                      : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800"><ShieldAlert className="h-3 w-3" /> {tr(T.unverified, lang)}</Badge>)
                    : <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600"><ShieldX className="h-3 w-3" /> {lang === 'ar' ? 'مؤرشفة' : 'archived'}</Badge>}
                  <Badge variant="secondary" dir="ltr">{p.lawId} · م {p.articleNo}</Badge>
                  <Badge variant="outline" dir="ltr">v{p.version}</Badge>
                  {p.gazetteRef && <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" /> {p.gazetteRef}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="leading-7" dir="rtl">{p.textAr}</p>
              <p className="text-xs leading-6 text-muted-foreground" dir="ltr">{p.textEn}</p>
              {p.verified && p.verificationNote && (
                <p className="rounded-md border bg-slate-50 p-2 text-xs" data-testid={`note-${p.id}`}>
                  <History className="me-1 inline h-3 w-3" />
                  <b>{tr(T.auditVerifiedBy, lang)}:</b> {p.verifiedBy?.split('|')[1] || p.verifiedBy}
                  {p.verifiedAt && <span dir="ltr"> · {new Date(p.verifiedAt).toISOString().slice(0, 10)}</span>}
                  {p.verificationNote ? <> — {p.verificationNote}</> : null}
                </p>
              )}
              {!p.isActive && p.verificationNote && (
                <p className="rounded-md border bg-slate-50 p-2 text-xs text-muted-foreground">{p.verificationNote}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {queue?.canVerify && p.isActive && (
                  <Button size="sm" variant={p.verified ? 'outline' : 'default'} onClick={() => openReview(p)} data-testid={`review-${p.id}`}>
                    {tr(T.auditReviewBtn, lang)}
                  </Button>
                )}
                {queue?.canVerify && !p.isActive && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => reactivate(p)} data-testid={`reactivate-${p.id}`}>
                    {tr(T.auditReactivateAction, lang)}
                  </Button>
                )}
              </div>

              {queue?.canVerify && openId === p.id && p.isActive && (
                <div className="space-y-3 rounded-lg border bg-slate-50 p-3" data-testid={`form-${p.id}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {(['verify', 'amend', 'deactivate'] as ActionChoice[]).map(a => (
                      <button key={a}
                        onClick={() => setChoice(a)}
                        className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${choice === a ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-100'}`}
                        data-testid={`choice-${a}`}>
                        {a === 'verify' ? tr(T.auditVerifyAction, lang) : a === 'amend' ? tr(T.auditAmendAction, lang) : tr(T.auditDeactivateAction, lang)}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{tr(T.auditNoteLabel, lang)}</Label>
                    <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} data-testid="audit-note" />
                  </div>
                  {choice !== 'deactivate' && (
                    <div className="flex flex-wrap gap-2">
                      <div className="min-w-48 flex-1 space-y-1">
                        <Label className="text-xs">{tr(T.auditGazetteLabel, lang)}</Label>
                        <Input dir="ltr" value={gazetteRef} onChange={e => setGazetteRef(e.target.value)} placeholder="الكويت اليوم — رقم / سنة" data-testid="audit-gazette" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tr(T.auditEffectiveFrom, lang)}</Label>
                        <Input type="date" dir="ltr" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} data-testid="audit-effective" />
                      </div>
                    </div>
                  )}
                  {choice === 'amend' && (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{tr(T.auditAmendTextLabel, lang)}</Label>
                        <Textarea rows={3} dir="rtl" value={textAr} onChange={e => setTextAr(e.target.value)} data-testid="audit-amend-ar" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tr(T.auditAmendTextEnLabel, lang)}</Label>
                        <Textarea rows={2} dir="ltr" value={textEn} onChange={e => setTextEn(e.target.value)} data-testid="audit-amend-en" />
                      </div>
                    </div>
                  )}
                  <Button size="sm" disabled={busy} onClick={() => submit(p)} data-testid="audit-submit">
                    {choice === 'verify' ? tr(T.auditVerifyAction, lang) : choice === 'amend' ? tr(T.auditAmendAction, lang) : tr(T.auditDeactivateAction, lang)}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {lang === 'ar' ? 'لا مواد مطابقة للمرشحات الحالية.' : 'No provisions match the current filters.'}
          </CardContent></Card>
        )}
        {rows.length > visible.length && (
          <p className="py-2 text-center text-xs text-muted-foreground" dir="auto">
            {lang === 'ar'
              ? `يُعرض ${visible.length} من ${rows.length} — استخدم البحث أو تصفية القانون للحصر.`
              : `Showing ${visible.length} of ${rows.length} — use search or the law filter to narrow down.`}
          </p>
        )}
      </div>
    </div>
  );
}
