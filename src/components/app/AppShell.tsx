/* eslint-disable react-hooks/set-state-in-effect -- data-fetch-on-mount pattern; setState occurs in async continuations */
'use client';

// App shell: multi-tenant header (org switcher), RTL Arabic-first chrome,
// always-visible disclaimer, and the ten panels (incl. the Phase 0 audit).

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, LogOut, Languages, Sparkles } from 'lucide-react';
import { api, ApiError } from './api';
import { tr, T, type Lang } from './i18n';
import { DisclaimerBar } from './compliance';
import { NotificationBell } from './NotificationBell';
import { AuthScreen, type Me } from './AuthScreen';
import { DashboardPanel, type CaseRow } from './panels/DashboardPanel';
import { TimelinePanel, type EventRow, type DeadlineRow } from './panels/TimelinePanel';
import { AlertsPanel, GroundsPanel, CounterPanel } from './panels/AnalysisPanels';
import { EvidencePanel, type DocumentRow } from './panels/EvidencePanel';
import { ResearchPanel } from './panels/ResearchPanel';
import { AuditPanel } from './panels/AuditPanel';
import { BillingPanel } from './panels/BillingPanel';
import { DraftsPanel, type DraftRow, type DraftTypeDef } from './panels/DraftsPanel';
import { CompliancePanel, type AuditRow } from './panels/CompliancePanel';
import { RelatedLaws } from './panels/RelatedLaws';
import type { AlertItem, GroundItem, AssertionResponse } from '@/lib/types';

type Tab = 'dashboard' | 'timeline' | 'alerts' | 'grounds' | 'counter' | 'evidence' | 'research' | 'audit' | 'drafts' | 'compliance' | 'billing';
const TABS: Tab[] = ['dashboard', 'timeline', 'alerts', 'grounds', 'counter', 'evidence', 'research', 'audit', 'drafts', 'compliance', 'billing'];

interface CaseDetail {
  case: CaseRow & { number: string; court: string; opponentPleading?: string };
  events: EventRow[];
  documents: DocumentRow[];
}
interface Analysis {
  alerts: AlertItem[];
  grounds: GroundItem[];
  deadlines: DeadlineRow[];
  counterEducational: { assertions: { id: number; text: string; kind: string }[]; responses: AssertionResponse[] } | null;
}

export function AppShell() {
  const [lang, setLang] = useState<Lang>('ar');
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftTypes, setDraftTypes] = useState<DraftTypeDef[]>([]);
  const [auditTick, setAuditTick] = useState(0);
  const [planBlocked, setPlanBlocked] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me') as unknown as Me;
      setMe(res);
      return true;
    } catch { setMe(null); return false; }
  }, []);

  const loadCases = useCallback(async () => {
    try {
      const res = await api.get('/api/cases') as { cases: CaseRow[] };
      setCases(res.cases || []);
    } catch { setCases([]); }
  }, []);

  useEffect(() => { loadMe().finally(() => setLoaded(true)); }, [loadMe]);

  useEffect(() => {
    if (!me) return;
    loadCases().then(() => setDetail(null));
    setActiveId(null);
  }, [me?.activeOrg?.id, me, loadCases]);

  const loadCaseBundle = useCallback(async (id: string) => {
    try {
      const [d, dr] = await Promise.all([
        api.get(`/api/cases/${id}`) as unknown as CaseDetail,
        api.get(`/api/cases/${id}/drafts`) as unknown as { drafts: DraftRow[]; types: DraftTypeDef[] }
      ]);
      setDetail(d); setDrafts(dr.drafts); setDraftTypes(dr.types);
    } catch { setDetail(null); }
    // Analysis is metered (Stage 5 fair use): a 402 means the workspace hit
    // its monthly cap — show the upgrade banner instead of the analysis panels.
    try {
      const a = await api.get(`/api/cases/${id}/analysis`) as unknown as Analysis;
      setAnalysis(a); setPlanBlocked(false);
    } catch (e) {
      setAnalysis(null);
      if (e instanceof ApiError && e.status === 402) setPlanBlocked(true);
    }
  }, []);

  useEffect(() => { if (activeId) loadCaseBundle(activeId); else { setDetail(null); setAnalysis(null); setDrafts([]); } }, [activeId, loadCaseBundle, auditTick]);

  const refreshCase = useCallback(() => {
    setAuditTick(t => t + 1);
    loadCases();
  }, [loadCases]);

  if (!loaded) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }
  if (!me) {
    return <AuthScreen lang={lang} onAuth={() => loadMe().then(() => setAuditTick(t => t + 1))} />;
  }

  const role = me.role || 'MEMBER';
  const openCase = detail?.case;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const switchOrg = async (orgId: string) => {
    await api.post('/api/auth/switch-org', { orgId });
    await loadMe();
  };
  const logout = async () => { await api.post('/api/auth/logout'); setMe(null); };

  const savePleading = async (text: string) => {
    if (!activeId) return;
    await api.put(`/api/cases/${activeId}`, { opponentPleading: text });
    refreshCase();
  };
  const feedback = async (targetId: string, value: 'helpful' | 'not_helpful' | 'needs_facts') => {
    if (!activeId) return;
    await api.post('/api/feedback', { caseId: activeId, targetType: 'alert', targetId, value }).catch(() => null);
  };

  return (
    <div className="min-h-screen bg-slate-100/60" dir={dir}>
      <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold leading-4">{tr(T.appName, lang)}</div>
              <div className="text-[10px] text-muted-foreground">{tr(T.brandSub, lang)}</div>
            </div>
          </div>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Select value={me.activeOrg?.id} onValueChange={switchOrg}>
              <SelectTrigger className="h-9 min-w-44" data-testid="org-switcher"><SelectValue /></SelectTrigger>
              <SelectContent>
                {me.orgs.map(o => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} · {o.type === 'NGO' ? 'جمعية' : o.type === 'LAW_FIRM' ? 'مكتب محاماة' : 'شخصي'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {me.activeOrg?.reviewQueueEnabled && <Badge variant="outline" className="border-violet-300 text-violet-700">review queue</Badge>}
            {me.activeOrg?.plan === 'PRO'
              ? <Badge className="border-amber-300 bg-amber-100 text-amber-900" data-testid="plan-badge">PRO</Badge>
              : <Badge variant="outline" className="text-muted-foreground" data-testid="plan-badge">FREE</Badge>}
            <Badge variant="outline" dir="ltr">{role}</Badge>
            <NotificationBell lang={lang} orgId={me.activeOrg?.id || ''} onOpenCase={id => { setActiveId(id); setTab('timeline'); }} />
            <Button size="sm" variant="ghost" onClick={() => setLang(l => (l === 'ar' ? 'en' : 'ar'))} data-testid="lang-toggle">
              <Languages className="h-4 w-4" /> {lang === 'ar' ? 'EN' : 'ع'}
            </Button>
            <Button size="sm" variant="ghost" onClick={logout} data-testid="logout"><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row">
        <aside className="lg:w-60 lg:shrink-0">
          <nav className="flex gap-1.5 overflow-x-auto rounded-xl border bg-white p-2 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-start text-sm transition-colors ${tab === t ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
                data-testid={`tab-${t}`}
              >
                {tr(T.nav[t], lang)}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <DisclaimerBar lang={lang} />

          {planBlocked && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="plan-limit-banner">
              <Sparkles className="h-4 w-4" />
              {tr(T.planLimitBanner, lang)}
              <Button size="sm" variant="outline" onClick={() => setTab('billing')} data-testid="plan-limit-goto">
                {tr(T.planLimitBannerAction, lang)}
              </Button>
            </div>
          )}

          {!activeId && tab !== 'research' && tab !== 'audit' && tab !== 'compliance' && tab !== 'billing' && (
            <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">
              {lang === 'ar' ? 'اختر قضية من اللوحة أو أنشئ واحدة.' : 'Pick a case from the dashboard or create one.'}
            </p>
          )}

          {tab === 'dashboard' && (
            <DashboardPanel
              lang={lang} cases={cases} activeId={activeId} role={role}
              onOpen={id => { setActiveId(id); setTab('timeline'); }}
              onCreated={id => { setActiveId(id); refreshCase(); setTab('timeline'); }}
            />
          )}
          {tab === 'timeline' && activeId && detail && (
            <div className="space-y-4">
              <TimelinePanel lang={lang} caseId={activeId} events={detail.events} deadlines={analysis?.deadlines || []} onChanged={refreshCase} />
              {/* RAG Phase 1 consumer: retrieval proposals from the case text,
                  resolved through the LKB before any citation display */}
              <RelatedLaws
                lang={lang}
                caseId={activeId}
                query={[
                  detail.case.opponentPleading?.slice(0, 280),
                  (detail.case as { subjectName?: string }).subjectName,
                  detail.case.opponent,
                  detail.case.caseType === 'family' ? 'أحوال شخصية نفقة حضانة' : 'مرافعات مدنية تنفيذ'
                ].filter(Boolean).join(' ')}
              />
            </div>
          )}
          {tab === 'alerts' && activeId && analysis && (
            <AlertsPanel lang={lang} caseId={activeId} alerts={analysis.alerts} onFeedback={feedback} />
          )}
          {tab === 'grounds' && analysis && (
            <GroundsPanel lang={lang} grounds={analysis.grounds} />
          )}
          {tab === 'counter' && activeId && analysis && (
            <CounterPanel
              lang={lang}
              breakdown={analysis.counterEducational}
              onSavePleading={savePleading}
              hasPleading={!!openCase?.opponentPleading}
            />
          )}
          {tab === 'evidence' && activeId && detail && (
            <EvidencePanel lang={lang} caseId={activeId} documents={detail.documents} onChanged={refreshCase} />
          )}
          {tab === 'research' && <ResearchPanel lang={lang} />}
          {tab === 'audit' && <AuditPanel lang={lang} />}
          {tab === 'drafts' && activeId && (
            <DraftsPanel lang={lang} caseId={activeId} drafts={drafts} types={draftTypes} role={role} onChanged={refreshCase} />
          )}
          {tab === 'compliance' && <CompliancePanel key={auditTick} lang={lang} role={role} />}
          {tab === 'billing' && <BillingPanel lang={lang} onPlanChanged={() => loadMe()} />}
        </main>
      </div>

      <footer className="border-t bg-white py-4 text-center text-xs text-muted-foreground">
        {lang === 'ar'
          ? 'الأخ الكبير v2.1 — منصة معلومات قانونية عامة. جميع المخرجات تتطلب مراجعة محامٍ مؤهل.'
          : 'Big Brother v2.1 — general legal information platform. All outputs require review by a qualified lawyer.'}
      </footer>
    </div>
  );
}
