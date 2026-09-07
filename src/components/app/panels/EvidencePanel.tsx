'use client';

// Evidence Log & Integrity (PRD 5.9): SHA-256 sealing, version chain with
// hash-mismatch flagging, integrity page. Data minimisation: only hashes and
// metadata are stored, never file content.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Fingerprint, GitCompareArrows } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { toast } from '@/hooks/use-toast';

export interface DocumentRow {
  id: string; name: string; hash: string; size: number; mime?: string;
  hashedAt: string; metaRisk: 'HIGH' | 'MEDIUM' | 'LOW'; notes?: string;
  version: number; previousId?: string;
}

const RISK_STYLE: Record<DocumentRow['metaRisk'], string> = {
  HIGH: 'border-red-200 bg-red-50/70',
  MEDIUM: 'border-amber-200 bg-amber-50/70',
  LOW: 'border-slate-200 bg-white'
};

export function EvidencePanel({ lang, caseId, documents, onChanged }: {
  lang: Lang; caseId: string; documents: DocumentRow[]; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [risk, setRisk] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await api.rawPost(`/api/cases/${caseId}/documents`, await file.arrayBuffer(), {
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
        'x-meta-risk': risk,
        'x-notes': encodeURIComponent(notes)
      }) as { hashMismatch: boolean };
      toast({
        title: lang === 'ar' ? 'خُتم المستند بالبصمة (SHA-256)' : 'Document sealed (SHA-256)',
        description: res.hashMismatch ? (lang === 'ar' ? 'تنبيه: البصمة تختلف عن الإصدار السابق — حُفظ الإصداران.' : 'Hash differs from previous version — both preserved.') : undefined,
        variant: res.hashMismatch ? 'destructive' : 'default'
      });
      setNotes('');
      onChanged();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{lang === 'ar' ? 'ختم مستند في السجل غير القابل للتغيير' : 'Seal a document into the immutable log'}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <span className="text-xs font-medium">{lang === 'ar' ? 'مؤشر المخاطرة الوصفي' : 'Descriptive meta-risk'}</span>
            <Select value={risk} onValueChange={v => setRisk(v as 'LOW' | 'MEDIUM' | 'HIGH')}>
              <SelectTrigger data-testid="doc-risk"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">{lang === 'ar' ? 'منخفض' : 'Low'}</SelectItem>
                <SelectItem value="MEDIUM">{lang === 'ar' ? 'متوسط' : 'Medium'}</SelectItem>
                <SelectItem value="HIGH">{lang === 'ar' ? 'مرتفع' : 'High'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <span className="text-xs font-medium">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</span>
            <input className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} data-testid="doc-file" />
            <Button disabled={busy} onClick={() => fileRef.current?.click()} data-testid="doc-upload">
              <Upload className="ms-1 h-4 w-4" /> {lang === 'ar' ? 'اختر ملفًا واختمه' : 'Choose file & seal'}
            </Button>
            <span className="ms-3 text-xs text-muted-foreground">
              {lang === 'ar' ? 'نخزّن البصمة والوصف فقط — لا نخزّن محتوى الملف (تحديد البيانات).' : 'Only the hash and metadata are stored — never the file content (data minimisation).'}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {documents.map(d => (
          <Card key={d.id} className={RISK_STYLE[d.metaRisk]} data-testid={`doc-${d.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium" dir="auto">{d.name}</CardTitle>
                <Badge variant="outline" className="bg-white">
                  {d.metaRisk === 'HIGH' ? (lang === 'ar' ? 'مخاطرة مرتفعة' : 'High risk') : d.metaRisk === 'MEDIUM' ? (lang === 'ar' ? 'مخاطرة متوسطة' : 'Medium risk') : (lang === 'ar' ? 'منخفض' : 'Low')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2" dir="ltr">
                <Fingerprint className="h-3.5 w-3.5 shrink-0" />
                <code className="truncate rounded bg-slate-100 px-1.5 py-0.5">{d.hash}</code>
              </div>
              <div className="text-slate-500" dir="ltr">{d.hashedAt?.slice(0, 19)}Z · v{d.version} · {Math.ceil(d.size / 1024)} KB</div>
              {d.previousId && (
                <div className="flex items-center gap-1 text-amber-700">
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  {lang === 'ar' ? 'سلسلة إصدارات محفوظة — قارن البصمات عند تغيّر النسخة.' : 'Version chain preserved — compare hashes across versions.'}
                </div>
              )}
              {d.notes && <p className="text-slate-600" dir="auto">{d.notes}</p>}
            </CardContent>
          </Card>
        ))}
        {documents.length === 0 && (
          <Card className="md:col-span-2"><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {lang === 'ar' ? 'لا مستندات مختومة بعد.' : 'No sealed documents yet.'}
          </CardContent></Card>
        )}
      </div>

      <p className="text-xs leading-6 text-muted-foreground">
        {lang === 'ar'
          ? 'إخلاء مسؤولية: مؤشرات المخاطرة ملاحظات وصفية على التعارضات الوصفية/الزمنية، ولا نقرر أبدًا أن مستندًا ما «مزوَّر» — يُناقش ذلك مع محامٍ عبر الإجراءات المقررة.'
          : 'Disclaimer: risk indicators are descriptive observations about metadata/timeline conflicts; we never conclude that a document is forged — raise any challenge with a lawyer through the proper procedures.'}
      </p>
    </div>
  );
}

void T; void tr;
