'use client';

// Timeline + Deadline Radar (PRD 5.2 / Goal 1): plain-language bilingual
// timeline with linked articles, plus derived statutory deadlines with
// urgency coloring and iCalendar export.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CalendarPlus, Download, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { toast } from '@/hooks/use-toast';

export interface EventRow {
  id: string; date: string; title: string; type: string; note?: string;
  appealFiled: boolean; defect: boolean;
}
export interface DeadlineRow {
  id: string; titleAr: string; titleEn: string; dueAt: string; kind: string;
  urgency: 'overdue' | 'critical' | 'soon' | 'later' | 'done'; daysLeft: number;
  provisionRef?: string;
}

const EVENT_TYPES = [
  { value: 'filing', ar: 'قيد الدعوى', en: 'Filing' },
  { value: 'service', ar: 'تبليغ', en: 'Service' },
  { value: 'service-issue', ar: 'إشكال تبليغ', en: 'Service problem' },
  { value: 'session', ar: 'جلسة', en: 'Session' },
  { value: 'adjournment', ar: 'تأجيل', en: 'Adjournment' },
  { value: 'submission', ar: 'مذكرة/مستند', en: 'Submission' },
  { value: 'late-submission', ar: 'تقديم متأخر', en: 'Late submission' },
  { value: 'judgment', ar: 'حكم', en: 'Judgment' },
  { value: 'prior-judgment', ar: 'حكم سابق (ذات نزاع)', en: 'Prior judgment (same dispute)' },
  { value: 'standing-issue', ar: 'إشكال صفة/مصلحة', en: 'Standing issue' },
  { value: 'claim-defect', ar: 'خلل صحيفة الدعوى', en: 'Claim-form defect' },
  { value: 'debt-due', ar: 'استحقاق الدين', en: 'Debt due date' },
  { value: 'execution', ar: 'إجراء تنفيذ', en: 'Execution step' },
  { value: 'maintenance-unpaid', ar: 'نفقة غير مدفوعة', en: 'Unpaid maintenance' },
  { value: 'custody-issue', ar: 'إشكال حضانة/مشاهدة', en: 'Custody/visitation issue' },
  { value: 'khul-request', ar: 'طلب خلع', en: "Khul' request" },
  { value: 'marriage-proof-issue', ar: 'إشكال إثبات الزواج', en: 'Marriage-proof issue' },
  { value: 'hearing', ar: 'جلسة تحقيق', en: 'Hearing' },
  { value: 'other', ar: 'أخرى', en: 'Other' }
];

const URGENCY_STYLE: Record<DeadlineRow['urgency'], string> = {
  overdue: 'border-red-300 bg-red-50 text-red-900',
  critical: 'border-orange-300 bg-orange-50 text-orange-900',
  soon: 'border-amber-200 bg-amber-50 text-amber-900',
  later: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  done: 'border-slate-200 bg-slate-50 text-slate-500'
};

export function TimelinePanel({
  lang, caseId, events, deadlines, onChanged
}: {
  lang: Lang; caseId: string; events: EventRow[]; deadlines: DeadlineRow[]; onChanged: () => void;
}) {
  const [form, setForm] = useState({ date: '', title: '', type: 'session', note: '' });
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)), [events]);

  const add = async () => {
    if (!form.date || !form.title) return;
    setBusy(true);
    try {
      await api.post(`/api/cases/${caseId}/events`, form);
      setForm({ date: '', title: '', type: 'session', note: '' });
      toast({ title: lang === 'ar' ? 'أُضيفت الواقعة' : 'Event added' });
      onChanged();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    await api.del(`/api/cases/${caseId}/events/${id}`).catch(() => null);
    onChanged();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Timeline */}
      <Card className="lg:col-span-3">
        <CardHeader><CardTitle>{lang === 'ar' ? 'الجدول الزمني للقضية' : 'Case timeline'}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ol className="relative space-y-4 border-s ps-5">
            {sorted.map(e => (
              <li key={e.id} className="relative">
                <span className="absolute -start-[1.45rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-400 shadow" />
                <div className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{e.title}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" dir="ltr">{e.date}</Badge>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {EVENT_TYPES.find(t => t.value === e.type)?.[lang]} · {e.appealFiled ? (lang === 'ar' ? 'قُدّم طعن' : 'appeal filed') : e.defect ? (lang === 'ar' ? 'عيب ظاهر' : 'defect noted') : ''}
                    {e.note ? ` — ${e.note}` : ''}
                  </div>
                </div>
              </li>
            ))}
            {sorted.length === 0 && <li className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا وقائع بعد.' : 'No events yet.'}</li>}
          </ol>

          <div className="rounded-xl border bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold">{lang === 'ar' ? 'أضف واقعة' : 'Add event'}</div>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="grid gap-1"><Label>{lang === 'ar' ? 'التاريخ' : 'Date'}</Label>
                <Input type="date" dir="ltr" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div className="grid gap-1 sm:col-span-2"><Label>{lang === 'ar' ? 'العنوان' : 'Title'}</Label>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div className="grid gap-1"><Label>{lang === 'ar' ? 'النوع' : 'Type'}</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t[lang]}</SelectItem>)}</SelectContent>
                </Select></div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={add} disabled={busy || !form.date || !form.title} data-testid="event-add">
                <CalendarPlus className="ms-1 h-4 w-4" /> {lang === 'ar' ? 'إضافة' : 'Add'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deadline Radar */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{lang === 'ar' ? 'رادار المواعيد' : 'Deadline Radar'}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => window.open(`/api/cases/${caseId}/deadlines-ics`, '_blank')} data-testid="ical-download">
            <Download className="ms-1 h-4 w-4" /> iCal
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {deadlines.map(d => (
            <div key={d.id} className={`rounded-lg border p-3 text-sm ${URGENCY_STYLE[d.urgency]}`} data-testid={`deadline-${d.urgency}`}>
              <div className="font-medium">{lang === 'ar' ? d.titleAr : d.titleEn}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" dir="ltr">{d.dueAt.slice(0, 10)}</Badge>
                <span>{tr(T.urgency[d.urgency], lang)}</span>
                {d.urgency !== 'done' && <span dir="ltr">({d.daysLeft >= 0 ? d.daysLeft : `+${-d.daysLeft}`} {lang === 'ar' ? 'يوم' : 'd'})</span>}
                {d.provisionRef && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">{d.provisionRef} · {lang === 'ar' ? 'غير مُتحقق' : 'unverified'}</Badge>}
              </div>
            </div>
          ))}
          {deadlines.length === 0 && <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا مواعيد مشتقة حاليًا — أضف واقعة حكم أو جلسة.' : 'No derived deadlines — add a judgment or session event.'}</p>}
          <p className="pt-1 text-xs leading-6 text-muted-foreground">
            {lang === 'ar'
              ? 'المواعيد مشتقة آليًا من وقائعك وتظل تقديرية — يجب التحقق منها مع محامٍ قبل الاعتماد عليها.'
              : 'Deadlines are derived from your events and remain estimates — a lawyer must verify them before you rely on them.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
