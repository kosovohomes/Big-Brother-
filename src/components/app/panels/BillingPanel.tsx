'use client';

// Plan & Usage panel (Stage 5 billing) — current plan, live usage meters,
// plan comparison, upgrade/cancel, and the billing ledger.
// Ethics: capacity-only gating — safety & compliance features are never paid
// features (stated in the panel copy, PRD UPL/access-to-justice stance).

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CreditCard, TrendingUp, Sparkles, Receipt, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../api';
import { tr, T, type Lang } from '../i18n';
import { toast } from '@/hooks/use-toast';

type LimitKey = 'maxActiveCases' | 'maxDocsPerCase' | 'maxMembers' | 'monthlyAnalysisRuns';

const LIMIT_LABELS: Record<LimitKey, { ar: string; en: string }> = {
  maxActiveCases: { ar: 'القضايا النشطة', en: 'Active cases' },
  maxDocsPerCase: { ar: 'المستندات لكل قضية', en: 'Documents per case' },
  maxMembers: { ar: 'أعضاء مساحة العمل', en: 'Workspace members' },
  monthlyAnalysisRuns: { ar: 'التحليلات الشهرية', en: 'Monthly analyses' }
};

interface BillingSummary {
  plan: 'FREE' | 'PRO';
  planStatus: string;
  planRenewsAt?: string | null;
  priceKwd: number;
  limits: Record<LimitKey, number>;
  usage: { activeCases: number; members: number; docsPerCaseMax: number; monthlyAnalysisRuns: number; month: string };
  stripeConfigured: boolean;
  canManage: boolean;
  events: { id: string; at: string; kind: string; plan: string; detail?: string; ref?: string }[];
}

const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  active: { ar: 'نشط', en: 'active' },
  canceled: { ar: 'ملغى', en: 'canceled' },
  past_due: { ar: 'متأخر السداد', en: 'past due' }
};

const KIND_LABEL: Record<string, { ar: string; en: string }> = {
  upgrade: { ar: 'ترقية', en: 'Upgrade' },
  downgrade: { ar: 'تخفيض / إلغاء', en: 'Downgrade / cancel' },
  'webhook.checkout.session.completed': { ar: 'دفع مكتمل (Stripe)', en: 'Checkout completed (Stripe)' },
  'webhook.customer.subscription.updated': { ar: 'تحديث اشتراك (Stripe)', en: 'Subscription updated (Stripe)' },
  'webhook.customer.subscription.deleted': { ar: 'إلغاء اشتراك (Stripe)', en: 'Subscription canceled (Stripe)' }
};

const PLAN_FEATURES: Record<'FREE' | 'PRO', { ar: string[]; en: string[] }> = {
  FREE: {
    ar: [
      'حتى 3 قضايا نشطة لكل مساحة عمل',
      'حتى 5 مستندات مختومة لكل قضية',
      'مساحة عمل فردية (عضو واحد)',
      'حتى 30 تحليلًا إجرائيًا شهريًا',
      'جميع ميزات السلامة والامتثال متاحة دائمًا'
    ],
    en: [
      'Up to 3 active cases per workspace',
      'Up to 5 sealed documents per case',
      'Solo workspace (1 member)',
      'Up to 30 procedural analyses per month',
      'All safety & compliance features always included'
    ]
  },
  PRO: {
    ar: [
      'حتى 50 قضية نشطة لكل مساحة عمل',
      'حتى 100 مستند مختوم لكل قضية',
      'فرق العمل: حتى 25 عضوًا',
      'حتى 2000 تحليل إجرائي شهريًا',
      'طابور مراجعة المنظمات بسعة أعلى وأولوية الدعم'
    ],
    en: [
      'Up to 50 active cases per workspace',
      'Up to 100 sealed documents per case',
      'Teams: up to 25 members',
      'Up to 2,000 procedural analyses per month',
      'Higher-capacity NGO review queue & priority support'
    ]
  }
};

export function BillingPanel({ lang, onPlanChanged }: { lang: Lang; onPlanChanged?: () => void }) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/billing') as unknown as BillingSummary;
      setSummary(res);
    } catch { setSummary(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upgrade = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/billing/checkout', { plan: 'PRO' }) as { mode: string; url?: string };
      if (res.mode === 'stripe' && res.url) {
        window.location.href = res.url;
        return;
      }
      toast({ title: tr(T.billingUpgraded, lang) });
      onPlanChanged?.();
      await load();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.post('/api/billing/cancel');
      toast({ title: tr(T.billingCanceledToast, lang) });
      onPlanChanged?.();
      await load();
    } catch (e) { toast({ title: e instanceof ApiError ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const plan = summary?.plan ?? 'FREE';
  const status = STATUS_LABEL[summary?.planStatus ?? 'active'] ?? { ar: summary?.planStatus ?? '', en: summary?.planStatus ?? '' };
  const usageRows: { key: LimitKey; used: number; max: number }[] = summary
    ? [
        { key: 'maxActiveCases', used: summary.usage.activeCases, max: summary.limits.maxActiveCases },
        { key: 'maxDocsPerCase', used: summary.usage.docsPerCaseMax, max: summary.limits.maxDocsPerCase },
        { key: 'maxMembers', used: summary.usage.members, max: summary.limits.maxMembers },
        { key: 'monthlyAnalysisRuns', used: summary.usage.monthlyAnalysisRuns, max: summary.limits.monthlyAnalysisRuns }
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="billing-panel">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><CreditCard className="h-4 w-4" /> {tr(T.billingTitle, lang)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-6 text-muted-foreground">{tr(T.billingExplain, lang)}</p>
          {summary && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" dir="ltr" data-testid="billing-plan" className={plan === 'PRO' ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}>
                {plan === 'PRO' ? tr(T.billingPro, lang) : tr(T.billingFree, lang)}
              </Badge>
              <span className="text-xs text-muted-foreground" data-testid="billing-status">
                {tr(T.billingStatus, lang)}: {tr(status, lang)}
              </span>
              {summary.planRenewsAt && (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {tr(T.billingRenews, lang)}: {summary.planRenewsAt.slice(0, 10)}
                </span>
              )}
              <span className="text-xs text-muted-foreground" dir="ltr">
                {summary.priceKwd} {tr(T.billingPerMonth, lang)}
              </span>
            </div>
          )}
          {summary?.canManage ? (
            <div className="flex flex-wrap gap-2">
              {plan === 'FREE' && (
                <Button size="sm" onClick={upgrade} disabled={busy} data-testid="billing-upgrade">
                  <Sparkles className="h-4 w-4" /> {tr(T.billingUpgrade, lang)}
                </Button>
              )}
              {plan === 'PRO' && (
                <Button size="sm" variant="outline" onClick={cancel} disabled={busy} data-testid="billing-cancel">
                  {tr(T.billingCancel, lang)}
                </Button>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed bg-slate-50 p-2 text-xs text-muted-foreground">{tr(T.billingManageOnly, lang)}</p>
          )}
          {!summary?.stripeConfigured && (
            <p className="rounded-md border bg-slate-50 p-2 text-[11px] leading-5 text-muted-foreground" data-testid="billing-demo-note">
              {tr(T.billingDemoNote, lang)}
            </p>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4" /> {tr(T.billingUsage, lang)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {usageRows.map(r => {
              const pct = Math.min(100, Math.round((r.used / Math.max(1, r.max)) * 100));
              return (
                <div key={r.key} className="space-y-1" data-testid={`usage-${r.key}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span>{tr(LIMIT_LABELS[r.key], lang)}</span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">{r.used} / {r.max}</span>
                  </div>
                  <Progress value={pct} />
                </div>
              );
            })}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              {lang === 'ar'
                ? 'ميزات السلامة والامتثال غير مقيّدة في أي باقة.'
                : 'Safety & compliance features are never gated by any plan.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{tr(T.billingPlans, lang)}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(['FREE', 'PRO'] as const).map(p => (
            <div key={p} className={`rounded-lg border p-3 ${plan === p ? 'border-slate-900' : ''}`}>
              <div className="mb-2 flex items-center justify-between">
                <b className="text-sm">{p === 'PRO' ? tr(T.billingPro, lang) : tr(T.billingFree, lang)}</b>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {p === 'PRO' ? '9 KWD / month' : '0 KWD'}
                </span>
              </div>
              <ul className="space-y-1 text-xs leading-6 text-muted-foreground">
                {PLAN_FEATURES[p][lang].map(f => <li key={f}>• {f}</li>)}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      {summary && summary.events.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Receipt className="h-4 w-4" /> {tr(T.billingHistory, lang)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.events.map(ev => {
              const kind = KIND_LABEL[ev.kind] ?? { ar: ev.kind, en: ev.kind };
              return (
                <div key={ev.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-slate-50 p-2 text-xs" data-testid="billing-event">
                  <Badge variant="secondary">{tr(kind, lang)}</Badge>
                  <span dir="ltr">{ev.plan}</span>
                  <span className="text-muted-foreground" dir="ltr">{ev.at.slice(0, 16).replace('T', ' ')}</span>
                  {ev.detail && <span className="text-muted-foreground">— {ev.detail}</span>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
