'use client';

// Dashboard: tenant case list, triage chips, and the new-case flow with the
// mandatory consent screen (PRD 5.1 AC3), NGO-assisted intake + voice-note
// intake as first-class paths (PRD 5.1 AC4 / Change 13).

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Plus, Mic, Users, ScrollText, Trash2, Loader2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { DRAFT_COVER_BILINGUAL, DisclaimerBar } from '../compliance';
import { toast } from '@/hooks/use-toast';

export interface CaseRow {
  id: string; number: string; court: string; circuit?: string;
  caseType: string; subType: string; role: string;
  opponent?: string; subjectName?: string; intakeChannel: string;
  eventCount?: number; documentCount?: number;
}

const CONSENT_TEXT =
  'أوافق على تخزين بيانات قضيتي (الوقائع، التواريخ، المستندات وبصماتها) لغرض تحليلها إجرائيًا وتقديم معلومات تعليمية، مع حق حذفها في أي وقت خلال 7 أيام كحد أقصى، وعدم مشاركتها دون إذن. / I consent to storing my case data (facts, dates, documents and hashes) for procedural analysis and educational information, with deletion within 7 days on request and no sharing without permission.';

export function DashboardPanel({
  lang, cases, activeId, onOpen, onCreated, role
}: {
  lang: Lang; cases: CaseRow[]; activeId: string | null;
  onOpen: (id: string) => void; onCreated: (id: string) => void; role: string;
}) {
  const [open, setOpen] = useState(false);
  const canCasework = ['OWNER', 'ADMIN', 'CASEWORKER'].includes(role);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{lang === 'ar' ? 'قضايا هذه المساحة' : 'Cases in this workspace'}</h2>
          <p className="text-sm text-muted-foreground">
            {lang === 'ar'
              ? 'جميع القضايا معزولة داخل مساحة العمل (تعدد المستأجرين).'
              : 'All cases are isolated within the workspace (tenant isolation).'}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-case"><Plus className="ms-1 h-4 w-4" /> {tr(T.newCase, lang)}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <NewCaseForm lang={lang} canCasework={canCasework} onDone={id => { setOpen(false); onCreated(id); }} />
          </DialogContent>
        </Dialog>
      </div>

      {cases.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          {lang === 'ar' ? 'لا توجد قضايا بعد — أنشئ قضيتك الأولى.' : 'No cases yet — create your first one.'}
        </CardContent></Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {cases.map(c => (
          <Card key={c.id} className={c.id === activeId ? 'border-slate-400 shadow-md' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base" data-testid={`case-number-${c.id}`}>{c.number || (lang === 'ar' ? 'بدون رقم' : 'No number')}</CardTitle>
                <Badge variant="outline">{c.caseType === 'civil' ? 'مدني' : c.caseType === 'criminal' ? 'جزائي' : 'أحوال شخصية'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="text-muted-foreground">{c.court || '—'}{c.circuit ? ` · ${c.circuit}` : ''}</div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1"><ScrollText className="h-3 w-3" /> {c.eventCount ?? 0} {lang === 'ar' ? 'واقعة' : 'events'}</Badge>
                <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> {c.documentCount ?? 0} {lang === 'ar' ? 'مستند' : 'docs'}</Badge>
                {c.intakeChannel === 'ngo_assisted' && <Badge className="bg-violet-100 text-violet-800">NGO</Badge>}
                {c.intakeChannel === 'voice_note' && <Badge className="bg-sky-100 text-sky-800"><Mic className="h-3 w-3" /></Badge>}
                {c.subjectName && <Badge variant="outline">{lang === 'ar' ? 'بالنيابة عن' : 'for'} {c.subjectName}</Badge>}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => onOpen(c.id)} data-testid={`open-case-${c.id}`}>
                  {lang === 'ar' ? 'فتح' : 'Open'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NewCaseForm({ lang, canCasework, onDone }: { lang: Lang; canCasework: boolean; onDone: (id: string) => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [intake, setIntake] = useState<'self' | 'ngo_assisted'>('self');
  const [voiceMode, setVoiceMode] = useState(false);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    number: '', court: '', circuit: '', caseType: 'civil', subType: 'execution',
    role: 'defendant', filedAt: '', servedAt: '', opponent: '', subjectName: '',
    opponentPleading: ''
  });
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [voiceResult, setVoiceResult] = useState<string>('');

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const createCase = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/cases', { ...form, intakeChannel: intake, consentText: CONSENT_TEXT }) as { id: string };
      if (voiceMode && recording) throw new Error('unreachable');
      toast({ title: lang === 'ar' ? 'أُنشئت القضية وسُجّلت الموافقة' : 'Case created with recorded consent' });
      onDone(res.id);
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };

  // Voice-note flow: create case first, then record & upload (consent stored server-side).
  const startRecording = async () => {
    try {
      const res = await api.post('/api/cases', { ...form, intakeChannel: 'voice_note', consentText: CONSENT_TEXT }) as { id: string };
      const caseId = res.id;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        setBusy(true);
        try {
          const r = await api.rawPost(`/api/cases/${caseId}/voice-note`, blob, {
            'Content-Type': mr.mimeType || 'audio/webm',
            'x-file-name': encodeURIComponent('voice-note.webm'),
            'x-voice-consent': '1'
          }) as { transcriptOk: boolean; transcript: string; fallback?: string };
          setVoiceResult(r.transcriptOk ? r.transcript : (r.fallback || ''));
          toast({ title: lang === 'ar' ? 'خُتم التسجيل بالبصمة' : 'Voice note sealed with hash' });
        } catch { toast({ title: lang === 'ar' ? 'تعذر إرسال التسجيل' : 'Upload failed', variant: 'destructive' }); }
        finally { setBusy(false); stream.getTracks().forEach(t => t.stop()); }
      };
      mr.start();
      setRecording(mr);
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    }
  };

  if (step === 1) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{tr(T.consentTitle, lang)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="max-h-40 overflow-y-auto rounded-lg border bg-slate-50 p-4 text-sm leading-7" dir="rtl">
            {CONSENT_TEXT}
          </div>
          {canCasework && (
            <RadioGroup value={intake} onValueChange={v => setIntake(v as 'self' | 'ngo_assisted')} className="grid gap-2">
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="self" /> {lang === 'ar' ? 'إدخال ذاتي (المسار الأساسي المتاح دائمًا)' : 'Self entry (primary, always-available path)'}
              </label>
              <label className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <RadioGroupItem value="ngo_assisted" /> {lang === 'ar' ? 'إدخال بمساعدة الجمعية — بالنيابة عن مستفيد بموافقة مُسجَّلة' : 'NGO-assisted intake — on behalf of a client with recorded consent'}
              </label>
            </RadioGroup>
          )}
          <label className="flex items-center gap-3 rounded-lg border p-3 text-sm" data-testid="consent-check">
            <Checkbox checked={consented} onCheckedChange={v => setConsented(v === true)} />
            {lang === 'ar' ? 'قرأت الموافقة وأقبلها.' : 'I have read and accept the consent.'}
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!consented} onClick={() => setStep(2)} data-testid="consent-next">{lang === 'ar' ? 'متابعة' : 'Continue'}</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lang === 'ar' ? 'بيانات القضية' : 'Case details'}</DialogTitle>
      </DialogHeader>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto pe-1">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'رقم القضية' : 'Case number'}</Label>
            <Input value={form.number} onChange={e => set('number', e.target.value)} data-testid="case-number" /></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'المحكمة' : 'Court'}</Label>
            <Input value={form.court} onChange={e => set('court', e.target.value)} /></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'الدائرة' : 'Circuit'}</Label>
            <Input value={form.circuit} onChange={e => set('circuit', e.target.value)} /></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'نوع المسار' : 'Track'}</Label>
            <Select value={form.caseType} onValueChange={v => set('caseType', v)}>
              <SelectTrigger data-testid="case-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="civil">{lang === 'ar' ? 'مدني/تجاري' : 'Civil/Commercial'}</SelectItem>
                <SelectItem value="criminal">{lang === 'ar' ? 'جزائي' : 'Criminal'}</SelectItem>
                <SelectItem value="family">{lang === 'ar' ? 'أحوال شخصية (أسرة)' : 'Family (personal status)'}</SelectItem>
              </SelectContent>
            </Select></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'صفحتي' : 'My role'}</Label>
            <Select value={form.role} onValueChange={v => set('role', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="defendant">{lang === 'ar' ? 'مدعى عليه' : 'Defendant'}</SelectItem>
                <SelectItem value="plaintiff">{lang === 'ar' ? 'مدعي' : 'Plaintiff'}</SelectItem>
              </SelectContent>
            </Select></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'الخصم' : 'Opponent'}</Label>
            <Input value={form.opponent} onChange={e => set('opponent', e.target.value)} /></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'تاريخ القيد' : 'Filing date'}</Label>
            <Input type="date" dir="ltr" value={form.filedAt} onChange={e => set('filedAt', e.target.value)} /></div>
          <div className="grid gap-1"><Label>{lang === 'ar' ? 'تاريخ التبليغ' : 'Service date'}</Label>
            <Input type="date" dir="ltr" value={form.servedAt} onChange={e => set('servedAt', e.target.value)} /></div>
        </div>
        {intake === 'ngo_assisted' && (
          <div className="grid gap-1">
            <Label>{lang === 'ar' ? 'اسم المستفيد (العميل)' : 'Client name'}</Label>
            <Input value={form.subjectName} onChange={e => set('subjectName', e.target.value)} data-testid="subject-name" />
          </div>
        )}
        <div className="grid gap-1">
          <Label>{lang === 'ar' ? 'نص مذكرة الخصم (اختياري — للتحليل التعليمي)' : "Opponent's pleading text (optional — for educational breakdown)"}</Label>
          <Textarea rows={4} value={form.opponentPleading} onChange={e => set('opponentPleading', e.target.value)} />
        </div>

        <div className="rounded-lg border p-3">
          <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={voiceMode} onCheckedChange={v => setVoiceMode(v === true)} data-testid="voice-mode" />
            <Mic className="h-4 w-4" /> {tr(T.voiceNote, lang)} — {lang === 'ar' ? 'صف قضيتك صوتيًا (مسموع للجميع، بلا حاجة لكتابة)' : 'Describe your case by voice (available to everyone)'}
          </label>
          {voiceMode && (
            <div className="mt-3 space-y-2">
              {!recording && <Button size="sm" onClick={startRecording} disabled={busy} data-testid="voice-start">● {lang === 'ar' ? 'ابدأ التسجيل وأنشئ القضية' : 'Start recording & create case'}</Button>}
              {recording && <Button size="sm" variant="destructive" onClick={() => recording.stop()} data-testid="voice-stop">■ {lang === 'ar' ? 'أوقف وأرسل' : 'Stop & upload'}</Button>}
              {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {lang === 'ar' ? 'جارٍ التحويل…' : 'Transcribing…'}</div>}
              {voiceResult && <div className="rounded bg-slate-50 p-2 text-sm" data-testid="voice-transcript">{voiceResult}</div>}
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setStep(1)}>{lang === 'ar' ? 'رجوع' : 'Back'}</Button>
        <Button onClick={createCase} disabled={busy || voiceMode} data-testid="case-create">{lang === 'ar' ? 'إنشاء' : 'Create'}</Button>
      </DialogFooter>
    </>
  );
}

void Progress; void DRAFT_COVER_BILINGUAL; void DisclaimerBar; void useEffect;
