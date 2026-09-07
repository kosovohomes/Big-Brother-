'use client';

// Discussion Drafts & Export (PRD 5.6 / 5.8 / 6.6) — Layer 2, explicit action:
//   - generation requires the mandatory acknowledgment (AckDialog)
//   - misconduct/Nazaha types: 24h cooling-off countdown + review-queue flow
//   - every export re-asks the acknowledgment server-side (428 otherwise)
//   - cover notice + defamation warning re-displayed on export success

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Lock, Timer, FileCheck2, ShieldAlert, Eye } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { AckDialog, DRAFT_COVER_BILINGUAL, EXPORT_ACK_BILINGUAL, DefamationWarning } from '../compliance';
import { toast } from '@/hooks/use-toast';

export interface DraftRow {
  id: string; type: string; titleAr: string; titleEn: string; status: string;
  finalizedAt?: string; releasedAt?: string; exportedAt?: string;
  coolingOffHours: number; reviewRequired: boolean;
  coolingOffEndsAt?: string; coolingOffRemainingSec: number; exportable: boolean;
  createdAt: string;
}
export interface DraftTypeDef {
  id: string; ar: string; en: string; coolingOffHours: number;
  reviewRequired: boolean; defamationWarning: boolean;
}

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DraftsPanel({
  lang, caseId, drafts, types, role, onChanged
}: {
  lang: Lang; caseId: string; drafts: DraftRow[]; types: DraftTypeDef[]; role: string;
  onChanged: () => void;
}) {
  const [selectedType, setSelectedType] = useState<string>('counter');
  const [ackOpen, setAckOpen] = useState<'generate' | 'export' | null>(null);
  const [activeDraft, setActiveDraft] = useState<DraftRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const def = types.find(t => t.id === selectedType);
  const canRelease = ['OWNER', 'ADMIN', 'LAWYER'].includes(role);

  const generate = async () => {
    setBusy(true); setAckOpen(null);
    try {
      await api.post(`/api/cases/${caseId}/drafts`, { type: selectedType, ackAccepted: true });
      toast({ title: lang === 'ar' ? 'وُلّدت مسودة النقاش وسُجّل الإقرار' : 'Discussion draft generated, acknowledgment logged' });
      onChanged();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const finalize = async (d: DraftRow) => {
    await api.post(`/api/drafts/${d.id}/finalize`).catch(e => toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }));
    onChanged();
  };
  const release = async (d: DraftRow) => {
    await api.post(`/api/drafts/${d.id}/release`).catch(e => toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }));
    onChanged();
  };
  const exportDraft = async (d: DraftRow) => {
    setBusy(true); setAckOpen(null);
    try {
      const res = await api.post(`/api/drafts/${d.id}/export`, { ackAccepted: true, format: 'json' }) as { draft: DraftRow; coverNotice: { ar: string } };
      toast({ title: lang === 'ar' ? 'تم التصدير وسُجّل الإقرار' : 'Export completed & acknowledgment logged' });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `discussion-draft-${d.type}-${d.id.slice(0, 8)}.json`;
      a.click();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        toast({ title: e.message, description: String((e.body as { detail?: string }).detail || ''), variant: 'destructive' });
      }
    } finally { setBusy(false); }
  };

  void def;

  return (
    <div className="space-y-4">
      {/* Explicit generation step (PRD 5.5 AC6) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{lang === 'ar' ? 'توليد مسودة نقاش — خطوة صريحة منفصلة (الطبقة الثانية)' : 'Generate a Discussion Draft — separate explicit step (Layer 2)'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="min-w-72" data-testid="draft-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {types.map(t => <SelectItem key={t.id} value={t.id}>{lang === 'ar' ? t.ar : t.en}</SelectItem>)}
            </SelectContent>
          </Select>
          {def && def.coolingOffHours > 0 && (
            <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-800">
              <Timer className="h-3 w-3" /> {tr(T.coolingOff, lang)} {def.coolingOffHours}h
            </Badge>
          )}
          {def && def.reviewRequired && (
            <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-violet-800">
              <ShieldAlert className="h-3 w-3" /> {lang === 'ar' ? 'يُحوَّل لطابور المراجعة' : 'routed to review queue'}
            </Badge>
          )}
          <Button onClick={() => setAckOpen('generate')} disabled={busy} data-testid="draft-generate">
            {tr(T.generateDraft, lang)}
          </Button>
        </CardContent>
      </Card>

      {/* Draft list */}
      <div className="grid gap-3">
        {drafts.map(d => (
          <Card key={d.id} data-testid={`draft-${d.id}`}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm" dir="auto">{lang === 'ar' ? d.titleAr : d.titleEn}</CardTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={d.status === 'IN_REVIEW' ? 'destructive' : d.status === 'EXPORTED' ? 'secondary' : 'outline'}>
                    {tr(T.draftStatus[d.status as keyof typeof T.draftStatus] || { ar: d.status, en: d.status }, lang)}
                  </Badge>
                  {d.coolingOffHours > 0 && d.coolingOffRemainingSec > 0 && d.status !== 'EXPORTED' && (
                    <Badge variant="outline" className="gap-1 border-red-300 text-red-800" dir="ltr" data-testid="cooling-countdown">
                      <Lock className="h-3 w-3" /> {fmt(d.coolingOffRemainingSec)}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="ghost" onClick={async () => {
                const res = await api.get(`/api/drafts/${d.id}`) as { draft: { payload: Record<string, unknown> } };
                setPreview(res.draft.payload);
              }}>
                <Eye className="h-4 w-4" /> {lang === 'ar' ? 'معاينة' : 'Preview'}
              </Button>
              {d.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => finalize(d)}><FileCheck2 className="h-4 w-4" /> {tr(T.finalizeDraft, lang)}</Button>}
              {d.status === 'IN_REVIEW' && canRelease && <Button size="sm" variant="outline" onClick={() => release(d)} data-testid="release-btn">{tr(T.releaseReview, lang)}</Button>}
              <Button
                size="sm"
                disabled={!d.exportable || d.status === 'EXPORTED' || busy}
                onClick={() => { setActiveDraft(d); setAckOpen('export'); }}
                data-testid={`export-${d.id}`}
              >
                <Download className="h-4 w-4" /> {tr(T.exportDraft, lang)}
              </Button>
            </CardContent>
          </Card>
        ))}
        {drafts.length === 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {lang === 'ar'
              ? 'لا مسودات بعد. الواجهة الافتراضية هي التفسير التعليمي فقط — التوليد خطوة صريحة منك.'
              : 'No drafts yet. The default view is the educational explainer only — generation is your explicit step.'}
          </CardContent></Card>
        )}
      </div>

      {/* Mandatory acknowledgment — generation */}
      <AckDialog
        open={ackOpen === 'generate'}
        onOpenChange={v => { if (!v) setAckOpen(null); }}
        lang={lang}
        title={lang === 'ar' ? 'إقرار إلزامي قبل توليد المسودة' : 'Mandatory acknowledgment before draft generation'}
        bodyText={DRAFT_COVER_BILINGUAL}
        defamation={def?.defamationWarning}
        onConfirm={generate}
        busy={busy}
      />
      {/* Mandatory acknowledgment — export (re-displayed, PRD 5.6 AC4) */}
      <AckDialog
        open={ackOpen === 'export' && !!activeDraft}
        onOpenChange={v => { if (!v) { setAckOpen(null); setActiveDraft(null); } }}
        lang={lang}
        title={lang === 'ar' ? 'إقرار إلزامي عند التصدير' : 'Mandatory acknowledgment at export'}
        bodyText={EXPORT_ACK_BILINGUAL}
        defamation={types.find(t => t.id === activeDraft?.type)?.defamationWarning}
        onConfirm={() => activeDraft && exportDraft(activeDraft)}
        busy={busy}
      />

      {/* Preview with the cover notice on top */}
      <Dialog open={!!preview} onOpenChange={v => { if (!v) setPreview(null); }}>
        <DialogContent className="max-w-3xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{lang === 'ar' ? 'معاينة المسودة' : 'Draft preview'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pe-1 text-sm">
            <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-center font-bold leading-8 text-red-900">
              {lang === 'ar'
                ? 'هذه مسودة نقاش تعليمية وُلِّدت آليًا انطلاقًا من معلومات قانونية عامة. هي ليست استشارة قانونية، ولم يراجعها محامٍ، ولا يجوز إيداعها أمام أي محكمة أو جهة دون مراجعة قانونية مستقلة.'
                : 'This is an educational discussion draft generated from general legal information. It is not legal advice, has not been reviewed by a lawyer, and must not be filed with any court without independent legal review.'}
            </div>
            {preview && <PayloadPreview payload={preview} lang={lang} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayloadPreview({ payload, lang }: { payload: Record<string, unknown>; lang: Lang }) {
  const grounds = (payload.grounds || []) as { ruleId: string; relevance: string; ar: string; en: string; citations?: unknown[] }[];
  const alerts = (payload.alerts || []) as { id: string; ar: string; en: string; severity: string }[];
  const p2p = (payload.pointByPoint || []) as { assertionId: number; assertion: string; position: { ar: string; en: string } }[];
  const integrity = (payload.integrity || []) as { name: string; hash: string; hashedAt: string; version: number }[];
  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold">{lang === 'ar' ? 'الملاحظات الإنذارية' : 'Informational flags'}</h4>
          <ul className="list-inside list-disc space-y-1 text-xs">{alerts.map(a => <li key={a.id} dir="auto">{lang === 'ar' ? a.ar : a.en}</li>)}</ul>
        </section>
      )}
      {grounds.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold">{lang === 'ar' ? 'فئات أسباب الرفض ذات الصلة' : 'Relevant ground categories'}</h4>
          <ul className="list-inside list-disc space-y-1 text-xs">{grounds.map(g => <li key={g.ruleId} dir="auto">{lang === 'ar' ? g.ar : g.en} — {g.relevance}</li>)}</ul>
        </section>
      )}
      {p2p.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold">{lang === 'ar' ? 'جدول النقاط نقطة-بنقطة' : 'Point-by-point table'}</h4>
          <div className="space-y-1 text-xs">
            {p2p.map(p => (
              <div key={p.assertionId} className="rounded border p-2" dir="auto">
                <b>#{p.assertionId}</b> — {p.assertion} · <i>{lang === 'ar' ? p.position.ar : p.position.en}</i>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h4 className="mb-1 font-semibold">{lang === 'ar' ? 'صفحة سلامة المستندات' : 'Document integrity page'}</h4>
        <ul className="space-y-1 text-xs" dir="ltr">
          {integrity.map((d, i) => <li key={i}><code>{d.hash.slice(0, 24)}…</code> — {d.name} (v{d.version}, {d.hashedAt?.slice(0, 10)})</li>)}
          {integrity.length === 0 && <li>{lang === 'ar' ? 'لا مستندات مختومة' : 'No sealed documents'}</li>}
        </ul>
      </section>
      <div className="flex justify-center">
        <DefamationWarning lang={lang} />
      </div>
    </div>
  );
}
