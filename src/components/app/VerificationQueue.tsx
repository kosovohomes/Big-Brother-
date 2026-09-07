'use client';

// Verification Queue (Task 13-c) — the lawyer's Phase 0 review screen.
// Backed by GET /api/kb/audit (queue with status/q/limit/offset filters) and
// POST /api/kb/audit/[id] (verify | deactivate | reactivate). Verification
// writes flow db.ts → Convex provisions:verify — which is token-gated
// server-side (Task 13-b); the browser never sees LAWYER_API_TOKEN.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, Search, ChevronRight, ChevronLeft, LogIn, Gavel, Archive, ArchiveRestore, ExternalLink } from 'lucide-react';
import { api, ApiError } from './api';

type Provision = {
  id: string; lawId: string; lawNameAr: string; articleNo: string;
  titleAr: string; textAr: string; gazetteRef?: string | null;
  verified: boolean; verificationNote?: string | null;
  verifiedBy?: string | null; verifiedAt?: string | null;
  version: number; isActive: boolean; effectiveFrom?: string | null;
};

type AuditStats = { total: number; verified: number; pending: number; superseded: number; byLaw: Record<string, { total: number; verified: number }> };

type QueueResponse = {
  stats: AuditStats; phase0Complete: boolean; canVerify: boolean;
  citationPolicy: string; filteredTotal: number; provisions: Provision[];
};

type Me = {
  user: { id: string; email: string; name: string };
  orgs: { id: string; name: string }[];
  activeOrg: { id: string; name: string } | null;
  role: string;
};

// Stable LKB catalog (mirrors rules/catalog.ts + corpus/SOURCES.json).
// 67/1976 is a legacy fixture row that appears to be Civil Code content
// mislabeled — flagged for the lawyer to reconcile in this very screen.
const LAW_LABELS: Record<string, string> = {
  '16/1960': 'قانون الجزاء (16/1960)',
  '17/1960': 'قانون الإجراءات والمحاكمات الجزائية (17/1960)',
  '35/1978': 'قانون إيجار العقارات (35/1978)',
  '38/1980': 'قانون المرافعات المدنية والتجارية (38/1980)',
  '51/1996': 'قانون الأحوال الشخصية (51/1996)',
  '67/1976': 'القانون المدني؟ صف تجريبي (67/1976)',
  '67/1980': 'القانون المدني (67/1980)',
  '9/2020': 'قانون التبليغات الإلكترونية (9/2020)',
  'CITRA': 'مبادئ حماية البيانات (CITRA)'
};

const PAGE_SIZE = 25;

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ar-KW', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

export function VerificationQueue() {
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState('lawyer@demo.kw');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [law, setLaw] = useState<string>('all');
  const [status, setStatus] = useState<'unverified' | 'verified' | 'archived'>('unverified');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [verifyTarget, setVerifyTarget] = useState<Provision | null>(null);
  const [verifyNote, setVerifyNote] = useState('');
  const [verifyGazette, setVerifyGazette] = useState('');
  const [verifyEffectiveFrom, setVerifyEffectiveFrom] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Provision | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivateBusy, setDeactivateBusy] = useState(false);

  const loadMe = useCallback(async () => {
    try { setMe(await api.get('/api/auth/me') as unknown as Me); }
    catch { setMe(null); }
    finally { setAuthChecked(true); }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);

  const loadQueue = useCallback(async (opts?: { offset?: number }) => {
    const effOffset = Math.max(opts?.offset ?? offset, 0);
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: String(PAGE_SIZE), offset: String(effOffset) });
      if (law !== 'all') params.set('law', law);
      if (q.trim()) params.set('q', q.trim());
      setQueue(await api.get(`/api/kb/audit?${params}`) as unknown as QueueResponse);
      setOffset(effOffset);
    } catch (e) {
      toast({ title: 'تعذّر تحميل قائمة التدقيق', description: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    } finally { setLoading(false); }
  }, [law, q, status, offset, toast]);

  useEffect(() => { if (me) void loadQueue(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [me, law, status]);

  const doLogin = async () => {
    setLoginBusy(true); setLoginError('');
    try {
      await api.post('/api/auth/login', { email: loginEmail, password: loginPassword });
      await loadMe();
    } catch (e) {
      setLoginError(e instanceof ApiError ? e.message : String(e));
    } finally { setLoginBusy(false); }
  };

  const switchOrg = async (orgId: string) => {
    try {
      await api.post('/api/auth/switch-org', { orgId });
      await loadMe();
      toast({ title: 'تم تبديل مساحة العمل' });
    } catch (e) {
      toast({ title: 'تعذّر تبديل مساحة العمل', description: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    }
  };

  const runAction = async (id: string, body: Record<string, unknown>, successTitle: string) => {
    try {
      await api.post(`/api/kb/audit/${id}`, body);
      toast({ title: successTitle });
      setVerifyTarget(null); setDeactivateTarget(null);
      setVerifyNote(''); setVerifyGazette(''); setVerifyEffectiveFrom(''); setDeactivateReason('');
      await loadQueue({ offset });
    } catch (e) {
      toast({ title: 'فشل الإجراء', description: e instanceof ApiError ? e.message : String(e), variant: 'destructive' });
    }
  };

  const laws = useMemo(() => {
    const ids = new Set<string>([...(queue?.stats.byLaw ? Object.keys(queue.stats.byLaw) : []), ...Object.keys(LAW_LABELS)]);
    return [...ids].sort();
  }, [queue]);

  if (!authChecked) return <div className="min-h-screen" />;
  if (!me) {
    // Compact login card — same session cookie as the main app.
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 pt-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-600 text-white">
                <Gavel className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-bold">قائمة تدقيق الاستشهادات — المرحلة صفر</h1>
              <p className="mt-1 text-sm text-muted-foreground">سجّل الدخول بحساب محامٍ لمراجعة نصوص القانون قبل اعتمادها</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-email">البريد الإلكتروني</Label>
              <Input id="v-email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-pass">كلمة المرور</Label>
              <Input id="v-pass" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void doLogin()} dir="ltr" />
              <p className="text-xs text-muted-foreground">حسابات تجريبية: lawyer@demo.kw · admin@demo.kw (كلمة المرور demo1234)</p>
            </div>
            {loginError && <p className="text-sm text-destructive">{loginError}</p>}
            <Button className="w-full" onClick={() => void doLogin()} disabled={loginBusy || !loginPassword}>
              <LogIn className="ml-2 h-4 w-4" /> {loginBusy ? 'جارٍ الدخول…' : 'دخول'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canVerify = me.role === 'LAWYER';
  const stats = queue?.stats;
  const pct = stats && stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0;
  const filteredTotal = queue?.filteredTotal ?? 0;
  const pageEnd = offset + (queue?.provisions.length ?? 0);

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* header + Phase 0 progress */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><Gavel className="h-6 w-6" /> قائمة تدقيق الاستشهادات — المرحلة صفر</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{queue?.citationPolicy ?? ''}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={canVerify ? 'default' : 'secondary'} className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> {canVerify ? `محامٍ — ${me.user.name}` : `${me.user.name} — عرض فقط`}
            </Badge>
            {me.orgs.length > 1 && (
              <Select value={me.activeOrg?.id ?? ''} onValueChange={(v) => void switchOrg(v)}>
                <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {me.orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {stats && (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>إجمالي النصوص: <b>{stats.total.toLocaleString('ar-KW')}</b></span>
                <span>موثّق: <b className="text-emerald-700">{stats.verified.toLocaleString('ar-KW')}</b></span>
                <span>بانتظار التدقيق: <b className="text-amber-700">{stats.pending.toLocaleString('ar-KW')}</b></span>
                <span>مؤرشف/مستبدل: <b>{stats.superseded.toLocaleString('ar-KW')}</b></span>
              </div>
              <Progress value={pct} />
              <p className="mt-2 text-xs text-muted-foreground">
                {queue?.phase0Complete ? 'اكتملت المرحلة صفر — جميع النصوص موثقة من محامٍ.' : `تقدّم التوثيق: ${pct}% — لا يُعرض أي استشهاد كنص موثق قبل اكتمال التدقيق.`}
              </p>
            </CardContent>
          </Card>
        )}

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={law} onValueChange={(v) => { setLaw(v); setOffset(0); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="كل القوانين" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القوانين</SelectItem>
              {laws.map((id) => <SelectItem key={id} value={id}>{LAW_LABELS[id] ?? id}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border">
            {([['unverified', 'بانتظار التدقيق'], ['verified', 'موثق'], ['archived', 'مؤرشف']] as const).map(([v, label]) => (
              <button key={v} onClick={() => { setStatus(v); setOffset(0); }}
                className={`px-3 py-2 text-sm ${status === v ? 'bg-primary text-primary-foreground' : 'bg-transparent'}`}>{label}</button>
            ))}
          </div>
          <div className="relative min-w-56 flex-1">
            <Search className="absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="رقم المادة أو كلمة من النص…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void loadQueue()} className="pr-8" />
          </div>
          <Button variant="secondary" onClick={() => void loadQueue()}>بحث</Button>
        </div>

        {/* queue */}
        {loading && !queue ? (
          <p className="py-16 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : !queue || queue.provisions.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
            {status === 'unverified' ? 'لا نصوص بانتظار التدقيق ضمن هذا التصنيف — أحسنت!' : 'لا نتائج مطابقة.'}
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {queue.provisions.map((p) => {
              const isExpanded = expanded.has(p.id);
              const long = p.textAr.length > 320;
              return (
                <Card key={p.id}>
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{LAW_LABELS[p.lawId] ?? p.lawId}</Badge>
                      <Badge variant="secondary">المادة {p.articleNo}</Badge>
                      <Badge variant="secondary">إصدار {p.version}</Badge>
                      {p.verified
                        ? <Badge className="bg-emerald-600 hover:bg-emerald-600">موثق ✓</Badge>
                        : <Badge variant="destructive">غير موثق</Badge>}
                      {!p.isActive && <Badge variant="outline">مؤرشف</Badge>}
                      {p.gazetteRef && <Badge variant="outline" className="font-normal">{p.gazetteRef}</Badge>}
                    </div>
                    {p.titleAr && <h3 className="font-semibold leading-relaxed">{p.titleAr}</h3>}
                    <p className={`whitespace-pre-line text-sm leading-7 text-foreground/90 ${!isExpanded && long ? 'line-clamp-4' : ''}`}>{p.textAr}</p>
                    {long && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>
                        {isExpanded ? 'إخفاء النص الكامل' : 'عرض النص الكامل'}
                      </Button>
                    )}
                    {p.verified && p.verificationNote && (
                      <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs leading-6 text-emerald-900">
                        مذكرة الاعتماد: {p.verificationNote}{p.verifiedBy ? ` — ${p.verifiedBy.split('|')[1] ?? p.verifiedBy}` : ''}{p.verifiedAt ? ` — ${fmtDate(p.verifiedAt)}` : ''}
                      </p>
                    )}
                    {canVerify && (
                      <div className="flex flex-wrap gap-2 border-t pt-3">
                        {!p.verified && p.isActive && (
                          <Button size="sm" onClick={() => { setVerifyTarget(p); setVerifyNote(''); setVerifyGazette(''); setVerifyEffectiveFrom(''); }}>
                            <ShieldCheck className="ml-1 h-4 w-4" /> اعتماد بعد مطابقة الجريدة الرسمية
                          </Button>
                        )}
                        {p.isActive && (
                          <Button size="sm" variant="outline" onClick={() => { setDeactivateTarget(p); setDeactivateReason(''); }}>
                            <Archive className="ml-1 h-4 w-4" /> أرشفة (لا يُستشهد به)
                          </Button>
                        )}
                        {!p.isActive && (
                          <Button size="sm" variant="outline" onClick={() => void runAction(p.id, { action: 'reactivate' }, 'تمت إعادة التنشيط للمراجعة')}>
                            <ArchiveRestore className="ml-1 h-4 w-4" /> إعادة تنشيط
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {/* pagination */}
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-muted-foreground">
                {filteredTotal > 0 ? `${offset + 1}–${pageEnd} من ${filteredTotal.toLocaleString('ar-KW')}` : '0'}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0 || loading}
                  onClick={() => void loadQueue({ offset: Math.max(0, offset - PAGE_SIZE) })}>
                  <ChevronRight className="h-4 w-4" /> السابق
                </Button>
                <Button variant="outline" size="sm" disabled={pageEnd >= filteredTotal || loading}
                  onClick={() => void loadQueue({ offset: offset + PAGE_SIZE })}>
                  التالي <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          <ExternalLink className="inline h-3 w-3" /> كل اعتماد يُسجَّل باسم المحامي وتاريخه ومرجع الجريدة — سجل تدقيق غير قابل للتعديل (PRD 6.3a)
        </p>
      </div>

      {/* verify dialog */}
      <Dialog open={!!verifyTarget} onOpenChange={(o) => !o && setVerifyTarget(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>اعتماد المادة {verifyTarget?.articleNo} — {verifyTarget ? (LAW_LABELS[verifyTarget.lawId] ?? verifyTarget.lawId) : ''}</DialogTitle>
            <DialogDescription>بعد مطابقة النص مع الجريدة الرسمية، سجّل أساس الاعتماد. يُقيّد الاعتماد باسمك وتاريخه.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="v-note">مذكرة الاعتماد (مطلوبة)</Label>
              <Textarea id="v-note" rows={3} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)}
                placeholder="مثال: طوبقت المادة مع نص الجريدة الرسمية؛ لا تعديلات لاحقة مؤثرة على هذا النص." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="v-gaz">مرجع الجريدة الرسمية (اختياري)</Label>
                <Input id="v-gaz" dir="ltr" value={verifyGazette} onChange={(e) => setVerifyGazette(e.target.value)} placeholder="الكويت اليوم، العدد/السنة" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-eff">سارٍ من (اختياري)</Label>
                <Input id="v-eff" type="date" value={verifyEffectiveFrom} onChange={(e) => setVerifyEffectiveFrom(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setVerifyTarget(null)}>إلغاء</Button>
            <Button disabled={verifyBusy || !verifyNote.trim()}
              onClick={() => verifyTarget && void runAction(verifyTarget.id, {
                action: 'verify', note: verifyNote.trim(),
                gazetteRef: verifyGazette.trim() || undefined,
                effectiveFrom: verifyEffectiveFrom || undefined
              }, 'تم اعتماد المادة — شكرًا لك')}>
              <ShieldCheck className="ml-1 h-4 w-4" /> {verifyBusy ? 'جارٍ الاعتماد…' : 'اعتماد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* deactivate dialog */}
      <Dialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>أرشفة المادة {deactivateTarget?.articleNo}</DialogTitle>
            <DialogDescription>النص المؤرشف لا يظهر كاستشهاد صالح في التطبيق. يمكن إعادته للمراجعة لاحقًا.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="d-reason">السبب (مطلوب)</Label>
            <Textarea id="d-reason" rows={3} value={deactivateReason} onChange={(e) => setDeactivateReason(e.target.value)}
              placeholder="مثال: نص مكرر، أو مُلغى بمرسوم لاحق، أو خارج نطاق المنصة." />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={deactivateBusy || !deactivateReason.trim()}
              onClick={() => deactivateTarget && void runAction(deactivateTarget.id, { action: 'deactivate', note: deactivateReason.trim() }, 'تمت أرشفة المادة')}>
              <Archive className="ml-1 h-4 w-4" /> أرشفة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
