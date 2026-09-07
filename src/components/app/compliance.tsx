'use client';

// Compliance UI atoms: citation badges, non-dismissible banners, and the
// mandatory acknowledgment dialog (PRD 5.5 AC3, 5.6 AC4, 5.8 AC2).

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldAlert, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { Lang } from './i18n';
import { tr, T } from './i18n';

export interface Citation {
  ref: { lawId: string; article: string; ar: string; en: string };
  resolved: boolean;
  verified: boolean;
  label: string;
}

// Citation chip: only resolved refs may render as citations; anything
// unresolved/unverified is forced to the unverified badge (PRD 6.3).
export function CitationBadge({ c, lang }: { c: Citation; lang: Lang }) {
  if (c.verified) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-800 bg-emerald-50" title={c.label}>
        <ShieldCheck className="h-3 w-3" />
        {c.ref.lawId} — م {c.ref.article}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-400 text-amber-800 bg-amber-50" title={c.label}>
      <ShieldAlert className="h-3 w-3" />
      {c.resolved
        ? `${c.ref.lawId} — م ${c.ref.article} · ${lang === 'ar' ? 'غير مُتحقق' : 'unverified'}`
        : lang === 'ar' ? 'مرجع غير مُتحقق — لا يُعرض كاستشهاد' : 'Unresolved — not shown as a citation'}
    </Badge>
  );
}

// Non-dismissible educational banner shown on EVERY ground view (5.5 AC3).
export function GroundBanner({ lang, slim = false }: { lang: Lang; slim?: boolean }) {
  return (
    <Alert className={slim ? 'py-2 border-amber-200 bg-amber-50/60' : 'border-amber-200 bg-amber-50/60'}>
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription className={lang === 'ar' ? 'text-right' : ''}>
        {lang === 'ar'
          ? 'هذه معلومة قانونية عامة تشرح ما تتطلبه القاعدة عادةً، وليست تحديدًا لانطباقها على قضيتك — يجب أن يؤكد المحامي ذلك.'
          : 'This is general legal information about what the rule usually requires, not a determination that it applies to your case — a lawyer must confirm.'}
      </AlertDescription>
    </Alert>
  );
}

export function DisclaimerBar({ lang }: { lang: Lang }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs leading-6 text-slate-600">
      {tr(T.disclaimer, lang)}
    </div>
  );
}

export function DefamationWarning({ lang }: { lang: Lang }) {
  return (
    <Alert className="border-red-200 bg-red-50/70">
      <AlertTriangle className="h-4 w-4 text-red-600" />
      <AlertDescription className={lang === 'ar' ? 'text-right' : ''}>
        {lang === 'ar'
          ? 'تحذير مسؤولية: الإبلاغ عن وقائع لم تثبت قد يعرّضك لمسؤولية القذف والتشهير. أرفق مستندات موثّقة فقط، واتّسم بالدقة والموضوعية، ولا تُطلق اتهامات نهائية. مسودتنا تعليمية للنقاش مع محامٍ أو جهة مساندة قبل أي تقديم.'
          : 'Responsibility warning: reporting unproven allegations may expose you to defamation liability. Attach only verified documents, stay factual and neutral, and avoid conclusive accusations. This draft is educational — bring it to a lawyer or supporting organisation before any submission.'}
      </AlertDescription>
    </Alert>
  );
}

// Mandatory acknowledgment dialog — checkbox + re-displayed banner at the
// moment of every draft generation AND every export (PRD 5.6 AC4).
export function AckDialog({
  open, onOpenChange, lang, title, bodyText, defamation, onConfirm, busy
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lang: Lang;
  title: string;
  bodyText: string;
  defamation?: boolean;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setChecked(false); onOpenChange(v); }}>
      <DialogContent className="max-w-xl" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {lang === 'ar' ? 'إقرار إلزامي غير قابل للتخطي قبل المتابعة.' : 'A mandatory, non-skippable acknowledgment before continuing.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border bg-slate-50 p-4 text-sm leading-7">
          {defamation && <DefamationWarning lang={lang} />}
          <p className="whitespace-pre-line font-semibold text-slate-800">{bodyText}</p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="ack-checkbox-row">
          <Checkbox checked={checked} onCheckedChange={v => setChecked(v === true)} className="mt-1" />
          <span>{tr(T.ackCheckbox, lang)}</span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button disabled={!checked || busy} onClick={() => { onConfirm(); }} data-testid="ack-confirm">
            {lang === 'ar' ? 'أُقرّ وأتابع' : 'Acknowledge & continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const DRAFT_COVER_BILINGUAL =
  'هذه مسودة نقاش تعليمية وُلِّدت آليًا انطلاقًا من معلومات قانونية عامة. هي ليست استشارة قانونية، ولم يراجعها محامٍ، ولا يجوز إيداعها أمام أي محكمة أو جهة دون مراجعة قانونية مستقلة.\nThis is an educational discussion draft generated from general legal information. It is not legal advice, has not been reviewed by a lawyer, and must not be filed with any court without independent legal review.';

export const EXPORT_ACK_BILINGUAL =
  'أُقرّ بأنني اطلعت على تنبيه أن هذه المادة معلومات قانونية عامة/مسودة نقاش تعليمية، أنها ليست استشارة قانونية لحالتي، أنها لم يراجعها محامٍ، وأنني سأراجعها مع محامٍ مؤهل قبل أي استخدام.\nI acknowledge that this material is general legal information / an educational discussion draft; that it is not legal advice for my case; that it has not been reviewed by a lawyer; and that I will review it with a qualified lawyer before any use.';
