/* eslint-disable react-hooks/set-state-in-effect -- data-fetch-on-mount pattern; setState occurs in async continuations */
'use client';

// Compliance & Data panel: UPL boundary (PRD 9.3), data controls (5.10),
// audit log (6.7), incident-response process (Change 11), consent records.

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Download, Trash2, ScrollText, Siren, ShieldX } from 'lucide-react';
import { api } from '../api';
import { type Lang } from '../i18n';
import { toast } from '@/hooks/use-toast';

export interface AuditRow { id: string; at: string; action: string; detail?: string; userId?: string }

const UPL_WILLNOT_AR = [
  'لا نختار أو نوصي باستراتيجية قانونية لحالتك.',
  'لا نجزم بأن أسباب الرفض تنطبق على قضيتك أو أن الدعوى ستنجح أو تفشل.',
  'لا نُعِدّ مستندات يُعتقد أنها جاهزة للإيداع، ولا نوجّهك لإيداع مسودة كأنها مُراجَعة.',
  'لا نقدّم أي شيء نيابةً عنك لأي محكمة أو جهة.',
  'لا نستبدل المحامي في أي نص داخل التطبيق أو مخرجاته.'
];
const UPL_WILLNOT_EN = [
  'We do not select or recommend a legal strategy for your case.',
  'We never assert that a specific ground applies to your case, or that a case will succeed or fail.',
  'We do not prepare documents represented as ready to file, nor instruct filing a draft as if reviewed.',
  'We do not submit anything to any court or authority on your behalf.',
  'We are not a substitute for a lawyer anywhere in the app or its outputs.'
];
const INCIDENT_AR = [
  '1) الاكتشاف: مراقبة مستمرة وتنبيهات على السجلات.',
  '2) التصعيد الداخلي: إبلاغ مسؤول الأمان خلال ساعة من التأكيد.',
  '3) التقييم: تحديد نطاق البيانات المتأثرة ومقارنتها بالتزامات الإخطار وفق أنظمة خصوصية البيانات الكويتية (يُحدد الإطار الزمني النهائي بمستشار قانوني).',
  '4) إخطار المستخدمين: خلال أقصر نافذة ممكنة من تأكيد الاختراق.',
  '5) التوثيق: تقرير كامل في سجل التدقيق ومراجعة ما بعد الحادث.'
];

export function CompliancePanel({ lang, role }: { lang: Lang; role: string }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const canSeeAudit = ['OWNER', 'ADMIN', 'LAWYER'].includes(role);

  const loadAudit = async () => {
    try { const res = await api.get('/api/audit') as { logs: AuditRow[] }; setLogs(res.logs || []); }
    catch { setLogs([]); }
  };
  useEffect(() => { if (canSeeAudit) loadAudit(); }, [canSeeAudit]);

  const exportData = async () => {
    const res = await api.get('/api/data/export');
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'big-brother-data-export.json';
    a.click();
    toast({ title: lang === 'ar' ? 'تم تصدير بياناتك' : 'Data exported' });
  };

  const deleteWorkspace = async () => {
    await api.post('/api/data/delete', { mode: 'workspace' });
    toast({ title: lang === 'ar' ? 'حُذفت بيانات هذه المساحة' : 'Workspace data purged' });
    window.location.reload();
  };
  const deleteAccount = async () => {
    await api.post('/api/data/delete', { mode: 'account' });
    toast({ title: lang === 'ar' ? 'جُدول حذف الحساب خلال 7 أيام' : 'Account deletion scheduled (7 days)' });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card data-testid="upl-boundary">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ShieldX className="h-4 w-4" /> {lang === 'ar' ? 'حدود الخدمة — ما لا نقوم به (حد المساعدة الذاتية/UPL)' : 'Service boundaries — what we will not do (self-help/UPL boundary)'}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1.5 text-sm leading-7">
            {(lang === 'ar' ? UPL_WILLNOT_AR : UPL_WILLNOT_EN).map((x, i) => <li key={i} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{x}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {lang === 'ar' ? 'وفق PRD v2.1 §9.3 — تخضع هذه الحدود لاعتماد محامٍ كويتي قبل الإطلاق.' : 'Per PRD v2.1 §9.3 — subject to Kuwaiti counsel sign-off before launch.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Siren className="h-4 w-4" /> {lang === 'ar' ? 'إجراء الاستجابة للحوادث وخرق البيانات' : 'Incident / breach response process'}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-inside list-decimal space-y-1.5 text-sm leading-7">
            {(lang === 'ar' ? INCIDENT_AR : INCIDENT_AR).map((x, i) => <li key={i} dir={lang === 'ar' ? 'rtl' : 'ltr'}>{x}</li>)}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{lang === 'ar' ? 'ضوابط البيانات' : 'Data controls'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportData} data-testid="export-data"><Download className="ms-1 h-4 w-4" /> {lang === 'ar' ? 'تصدير الجدول الزمني وبياناتي' : 'Export my timeline & data'}</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="delete-workspace"><Trash2 className="ms-1 h-4 w-4" /> {lang === 'ar' ? 'حذف بيانات هذه المساحة' : 'Delete workspace data'}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <AlertDialogHeader>
                <AlertDialogTitle>{lang === 'ar' ? 'تأكيد الحذف النهائي' : 'Confirm permanent deletion'}</AlertDialogTitle>
                <AlertDialogDescription>
                  {lang === 'ar'
                    ? 'سيُحذف كل شيء في هذه المساحة فورًا: القضايا، الوقائع، بصمات المستندات، والمسودات. لا يمكن التراجع.'
                    : 'Everything in this workspace will be purged immediately: cases, events, document hashes, and drafts. Irreversible.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction onClick={deleteWorkspace}>{lang === 'ar' ? 'احذف الآن' : 'Delete now'}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="border-red-200 text-red-700" data-testid="delete-account">{lang === 'ar' ? 'حذف حسابي وبياناتي (7 أيام)' : 'Delete my account & data (7 days)'}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              <AlertDialogHeader>
                <AlertDialogTitle>{lang === 'ar' ? 'حذف الحساب' : 'Account deletion'}</AlertDialogTitle>
                <AlertDialogDescription>
                  {lang === 'ar'
                    ? 'يُجاس الحساب للحذف ويكتمل خلال 7 أيام كحد أقصى وفق سجل موافقته. سيتم تسجيل الخروج.'
                    : 'Your account is scheduled for deletion, completing within 7 days. You will be signed out.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAccount}>{lang === 'ar' ? 'تأكيد' : 'Confirm'}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {canSeeAudit && (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><ScrollText className="h-4 w-4" /> {lang === 'ar' ? 'سجل التدقيق (الوصول والتصدير والعمليات)' : 'Audit log (access, exports & operations)'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 space-y-1 overflow-y-auto" data-testid="audit-log">
              {logs.map(l => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs">
                  <Badge variant="outline" dir="ltr">{l.at?.slice(0, 19)}Z</Badge>
                  <Badge variant="secondary" dir="ltr">{l.action}</Badge>
                  <span className="text-slate-600" dir="ltr">{l.detail}</span>
                </div>
              ))}
              {logs.length === 0 && <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا سجلات بعد.' : 'No logs yet.'}</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
