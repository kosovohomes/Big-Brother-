// Deterministic analysis engine (PRD §5.5, §6.2, §6.5, §7 Explainability).
// Pure function: caseData + LKB provisions -> { alerts, grounds, deadlines }.
// Layer 1 (this function's output) is the DEFAULT view: educational,
// neutral-language explanations. Case-specific "Discussion Drafts" are a
// separate, explicit user action (see packs.ts / PackDraft API).
//
// Citation integrity (PRD §6.3 Change 5 + §6.3a): every rule ref is resolved
// against the structured Legal Knowledge Base passed in by the caller.
// Unresolved refs are returned with resolved:false and NEVER displayed as
// article citations; unverified entries are always flagged.

import { RULES, WINDOWS } from './rules/catalog';
import type {
  AlertItem, CaseData, DeadlineItem, EngineResult, GroundItem,
  ProvisionT, Relevance, ResolvedCitation, Severity
} from './types';

const DAY = 86400000;
const today = () => new Date();

function daysBetween(a: string, b: string | Date): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY);
}

function snippet(text?: string | null, max = 140): string {
  const t = (text || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// normalize article strings for matching: unify dash variants, drop spaces
const normArt = (s: string) => s.replace(/[–—−]/g, '-').replace(/\s+/g, '').toLowerCase();

// Resolve a structured ref {lawId, article} to the LKB. A ref like "33-42"
// matches exact articleNo or a provision whose articleNo is contained in the
// range string. Unresolved => flagged, never shown as a citation.
export function resolveRef(ref: { lawId: string; article: string }, provisions: ProvisionT[]): ResolvedCitation {
  const a = normArt(ref.article);
  const hit =
    provisions.find(p => p.lawId === ref.lawId && normArt(p.articleNo) === a) ||
    provisions.find(p => p.lawId === ref.lawId && normArt(p.articleNo).split('-').some(part => a.includes(part))) ||
    null;
  if (!hit) {
    return {
      ref,
      resolved: false,
      verified: false,
      label: 'غير مُتحقق منه — لا يُعرض كاستشهاد / Unverified — not shown as a citation'
    };
  }
  return {
    ref,
    provisionId: hit.id,
    resolved: true,
    verified: hit.verified,
    label: hit.verified ? 'مُتحقق منه' : 'غير مُتحقق منه — بانتظار التدقيق المرجعي (المرحلة صفر) / Unverified — pending Phase 0 citation audit'
  };
}

function resolveAll(
  refs: { lawId: string; article: string }[] | undefined,
  provisions: ProvisionT[]
): ResolvedCitation[] {
  return (refs || []).map(r => resolveRef(r, provisions));
}

// ---------- Deadline Radar derivation (urgency computed here) ----------
export function urgencyOf(dueAt: string, completed: boolean): DeadlineItem['urgency'] {
  if (completed) return 'done';
  const d = daysBetween(today().toISOString(), dueAt);
  if (d < 0) return 'overdue';
  if (d <= 7) return 'critical';
  if (d <= 30) return 'soon';
  return 'later';
}

export function deriveDeadlines(c: CaseData): Omit<DeadlineItem, 'urgency'>[] {
  const win = WINDOWS[c.caseType] || WINDOWS.civil;
  const out: Omit<DeadlineItem, 'urgency'>[] = [];
  const events = [...(c.events || [])].filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));
  const lawRef = c.caseType === 'criminal' ? 'CrCL 17/1960 م 231' : c.caseType === 'family' ? 'L.51/1996 — window under verification' : 'CPL 38/1980 م 163';

  events.filter(e => e.type === 'judgment' && !e.appealFiled).forEach(j => {
    const due = new Date(new Date(j.date).getTime() + win.appeal * DAY).toISOString();
    out.push({
      id: `DL-APPEAL-${j.id}`,
      titleAr: `مهلة الطعن على الحكم (${win.appeal} يومًا) — تحقق فورًا مع محامٍ`,
      titleEn: `Appeal window for the judgment (${win.appeal} days) — verify with a lawyer urgently`,
      dueAt: due,
      kind: 'appeal',
      provisionRef: lawRef,
      sourceEventId: j.id
    });
  });
  // upcoming sessions (next 60 days)
  events.filter(e => (e.type === 'session' || e.type === 'hearing')).forEach(s => {
    const d = daysBetween(today().toISOString(), s.date);
    if (d >= -1 && d <= 60) {
      out.push({
        id: `DL-SESSION-${s.id}`,
        titleAr: `جلسة قادمة: ${s.title}`,
        titleEn: `Upcoming session: ${s.title}`,
        dueAt: s.date,
        kind: 'session',
        sourceEventId: s.id
      });
    }
  });
  return out;
}

// ---------- main analysis ----------
export function analyze(c: CaseData, provisions: ProvisionT[]): EngineResult {
  const alerts: AlertItem[] = [];
  const grounds: GroundItem[] = [];
  const events = [...(c.events || [])].filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));
  const win = WINDOWS[c.caseType] || WINDOWS.civil;
  const R = (id: string) => RULES.find(r => r.id === id);

  const alert = (
    id: string, ruleId: string, severity: Severity, ar: string, en: string,
    displayArticles: string[], refs: { lawId: string; article: string }[] | undefined, evidence: string
  ) => alerts.push({
    id, ruleId, severity, ar, en,
    articles: displayArticles,
    citations: resolveAll(refs, provisions),
    evidence
  });

  // --- 1. Missed statutory deadline (appeal window after a judgment) ---
  const judgments = events.filter(e => e.type === 'judgment');
  judgments.forEach(jd => {
    if (!jd.appealFiled) {
      const elapsed = daysBetween(jd.date, today());
      const deadline = new Date(new Date(jd.date).getTime() + win.appeal * DAY);
      const arT = c.caseType === 'criminal' ? 'م 231 إ.ج' : c.caseType === 'family' ? 'مواعيد الطعن في ق 51/1996 (تحت التدقيق)' : 'م 163 م.م.م';
      const enT = c.caseType === 'criminal' ? 'Art. 231 CrCL' : c.caseType === 'family' ? 'L.51/1996 windows (under verification)' : 'Art. 163 CPL';
      const refs = c.caseType === 'criminal' ? [{ lawId: '17/1960', article: '231' }] : c.caseType === 'family' ? [{ lawId: '51/1996', article: '215' }] : [{ lawId: '38/1980', article: '163' }];
      if (elapsed > win.appeal) {
        alert(
          `AL-APPEAL-${jd.id}`, c.caseType === 'criminal' ? 'CRIM-APPEAL' : c.caseType === 'family' ? 'FAM-APPEAL-013' : 'CIV-APPEAL',
          'high',
          `يبدو أن مهلة الطعن (${win.appeal} يومًا) قد انتهت بتاريخ ${deadline.toLocaleDateString('ar-KW')} دون تقديم طعن وفق ${arT}. هذه معلومة قانونية عامة وليست استشارة قانونية لحالتك. نوصي بمراجعة محامٍ فورًا لمعرفة ما إذا كان هذا ينطبق على قضيتك.`,
          `It appears the ${win.appeal}-day appeal window expired on ${deadline.toLocaleDateString('en-GB')} without filing, per ${enT}. This is general legal information, not legal advice for your case. We recommend immediate lawyer review to determine whether this applies to your situation.`,
          [arT, enT], refs, snippet(`${jd.title} — ${jd.date}`)
        );
      } else if (elapsed > win.appeal * 0.6) {
        alert(
          `AL-APPEAL-SOON-${jd.id}`, 'DEADLINE-SOON', 'medium',
          `اقتربت نهاية مهلة الطعن (${deadline.toLocaleDateString('ar-KW')}). تحقق من موعدك المتبقي وراجع محاميًا في أقرب وقت.`,
          `The appeal window closes soon (${deadline.toLocaleDateString('en-GB')}). Check your remaining time and consult a lawyer promptly.`,
          [arT, enT], refs, snippet(`${jd.title} — ${jd.date}`)
        );
      }
    }
  });

  // --- 2. Defective / late service ---
  const servRefs = [{ lawId: '38/1980', article: '8-26' }, { lawId: '9/2020', article: '1' }];
  const servAr = ['م 8–26 م.م.م', 'ق 9/2020'];
  const servEn = ['Arts. 8–26 CPL', 'Law 9/2020'];
  if (c.filedAt && c.servedAt) {
    const gap = daysBetween(c.filedAt, c.servedAt);
    if (gap > 60) {
      alert('AL-SERVICE-LATE', 'CIV-SERV-005', 'medium',
        `مضت ${gap} يومًا بين قيد الدعوى والتبليغ. قد يؤثر ذلك على صحة الإجراءات أو سريان المهل. هذه معلومة عامة — نناقشها مع محامٍ.`,
        `${gap} days elapsed between filing and service. This may affect procedural validity or the running of deadlines. General information — discuss with a lawyer.`,
        [...servAr, ...servEn], servRefs, `قيد: ${c.filedAt} — تبليغ: ${c.servedAt}`);
    }
  }
  if (events.some(e => e.type === 'service-issue')) {
    alert('AL-SERVICE-DEFECT', 'CIV-SERV-005', 'high',
      'أشرت إلى إشكال في التبليغ. قد يترتب عليه بطلان إذا لم تُراعَ الأوضاع المقررة قانونًا. هذه معلومة قانونية عامة، وننصح بمراجعة محامٍ لتقييم انطباقها.',
      'You recorded a service problem. Non-compliant service may be null. This is general legal information; lawyer review is advised.',
      [...servAr, ...servEn], servRefs, snippet(events.find(e => e.type === 'service-issue')?.note));
    buildGround('CIV-SERV-005', 'high', ['إشكال تبليغ مسجل في الجدول الزمني'], c, provisions, grounds);
  }

  // --- 3. Repeated adjournments (anomaly / abuse pattern) ---
  const adjournments = events.filter(e => e.type === 'adjournment');
  if (adjournments.length >= 3) {
    alert('AL-ADJOURN', 'CIV-ABUSE-009', adjournments.length >= 5 ? 'high' : 'medium',
      `تم تأجيل القضية ${adjournments.length} مرات. التكرار دون سبب مشروع قد يشير إلى مماطلة. هذه ملاحظة إنذارية عامة وليست حكمًا على نوايا أحد.`,
      `The case was adjourned ${adjournments.length} times. Repeated adjournment without cause may indicate dilatory tactics. This is an informational pattern note, not a judgment on anyone's intent.`,
      ['م 96 م.م.م', 'Art. 96 CPL'], [{ lawId: '38/1980', article: '96' }], adjournments.map(a => a.date).join('، '));
    buildGround('CIV-ABUSE-009', adjournments.length >= 5 ? 'medium' : 'low', [`${adjournments.length} تأجيلات مسجلة`], c, provisions, grounds);
  }

  // --- 4. Last-minute evidence pattern ---
  const lateDocs = events.filter(e => e.type === 'late-submission');
  if (lateDocs.length >= 2) {
    alert('AL-LATE-DOC', 'CIV-ABUSE-009', 'medium',
      'تكرار تقديم مستندات في اللحظة الأخيرة. قد يخول طلب استبعادها أو مهلة للرد — معلومة عامة تتطلب تقييم محامٍ.',
      'Repeated last-minute evidence submission. May support an exclusion request or time to respond — general information requiring lawyer assessment.',
      ['م 96 م.م.م', 'Art. 96 CPL'], [{ lawId: '38/1980', article: '96' }], lateDocs.map(d => d.date).join('، '));
  }

  // --- 5. Judgment missing mandatory elements ---
  if (events.some(e => e.type === 'judgment' && e.defect)) {
    alert('AL-JUDG-DEFECT', 'CIV-NULL-006', 'high',
      'الحكم يبدو ناقصًا أركانًا إلزامية (الوقائع، الأسباب، المنطوق). قد يؤسس لطلب بطلان أو تمييز — معلومة عامة يجب تأكيدها مع محامٍ.',
      'The judgment appears to lack mandatory elements (facts, reasons, operative ruling). May ground nullity or appeal — general information to confirm with a lawyer.',
      ['م 156 م.م.م', 'Art. 156 CPL'], [{ lawId: '38/1980', article: '156' }], snippet(events.find(e => e.type === 'judgment' && e.defect)?.note));
  }

  // --- 6. Prior final judgment on the same dispute (res judicata / double jeopardy) ---
  if (events.some(e => e.type === 'prior-judgment')) {
    const rid = c.caseType === 'criminal' ? 'CRIM-DOUBLE-004' : c.caseType === 'family' ? 'FAM-DIV-006' : 'CIV-RESJ-003';
    buildGround(rid, 'high', ['حكم سابق مسجل في الجدول الزمني'], c, provisions, grounds);
  }

  // --- 7. Standing / cause-of-action flags from timeline ---
  if (events.some(e => e.type === 'standing-issue')) {
    buildGround(c.caseType === 'family' ? 'FAM-MAINT-004' : 'CIV-STAND-002', 'medium', ['إشارة إلى انعدام الصفة/المصلحة'], c, provisions, grounds);
  }
  if (events.some(e => e.type === 'claim-defect')) {
    buildGround(c.caseType === 'family' ? 'FAM-MARR-002' : 'CIV-CAUSE-007', 'medium', ['خلل في بيانات صحيفة الدعوى'], c, provisions, grounds);
  }

  // --- 8. Limitation check (debt/execution) ---
  const dueEvent = events.find(e => e.type === 'debt-due');
  if (dueEvent && c.filedAt) {
    const yrs = daysBetween(dueEvent.date, c.filedAt) / 365;
    if (yrs > 5) buildGround('CIV-LIM-004', 'high', [`مضي ${yrs.toFixed(1)} سنوات بين الاستحقاق والقيد`], c, provisions, grounds);
    else if (yrs > 4) buildGround('CIV-LIM-004', 'medium', [`مضي ${yrs.toFixed(1)} سنوات بين الاستحقاق والقيد — تحقق من قواطع التقادم`], c, provisions, grounds);
  }

  // --- 9. Family-specific timeline triggers ---
  if (c.caseType === 'family') {
    if (events.some(e => e.type === 'maintenance-unpaid')) {
      buildGround('FAM-MAINT-004', 'medium', ['سجل نفقة غير مدفوعة في الجدول الزمني'], c, provisions, grounds);
      buildGround('FAM-EXEC-014', 'medium', ['احتمال اللجوء لإجراءات تنفيذ النفقة'], c, provisions, grounds);
    }
    if (events.some(e => e.type === 'custody-issue')) {
      buildGround('FAM-CUST-010', 'medium', ['إشكال حضانة/مشاهدة مسجل'], c, provisions, grounds);
      buildGround('FAM-VISIT-011', 'medium', ['إشكال مشاهدة مسجل'], c, provisions, grounds);
    }
    if (events.some(e => e.type === 'khul-request')) buildGround('FAM-KHUL-007', 'medium', ['طلب خلع مسجل'], c, provisions, grounds);
    if (events.some(e => e.type === 'marriage-proof-issue')) buildGround('FAM-MARR-002', 'high', ['إشكال إثبات عقد الزواج'], c, provisions, grounds);
  }

  // --- 10. Document forgery-risk rollup (never asserts forgery) ---
  const riskyDocs = (c.documents || []).filter(d => d.metaRisk === 'HIGH' || d.metaRisk === 'MEDIUM');
  riskyDocs.forEach(d => {
    alert(`AL-FORGERY-${d.id}`, 'FORGERY', d.metaRisk === 'HIGH' ? 'high' : 'medium',
      `المستند «${d.name}» يحمل مؤشرات مخاطرة (تعارض بيانات وصفية/زمنية). لا نقرر وجود تزوير — ننوه بمخاطرة عالية وندعو لدراسة الطعن بالتزوير مع محامٍ.`,
      `Document "${d.name}" shows risk indicators (metadata/timeline conflict). We do not conclude forgery — we flag high irregularity risk and suggest discussing a formal challenge with a lawyer.`,
      ['م 257–260 جزاء', 'Penal Arts. 257–260'], [{ lawId: '16/1960', article: '257-260' }],
      `SHA-256: ${(d.hash || '').slice(0, 16)}… — ${d.notes || ''}`);
  });

  // --- 11. Baseline grounds always surfaced (systematic completeness, PRD §5.5 AC1) ---
  const already = new Set(grounds.map(g => g.ruleId));
  RULES.filter(r => r.track === c.caseType && !already.has(r.id)).forEach(r => {
    buildGround(r.id, 'low', ['لم تُستوفَ المتطلبات الواقعية بعد — أضف وقائع لتقييم أدق'], c, provisions, grounds);
  });

  // --- Deadline Radar ---
  const deadlines: DeadlineItem[] = deriveDeadlines(c).map(d => ({
    ...d,
    urgency: urgencyOf(d.dueAt, false),
    daysLeft: Math.floor((new Date(d.dueAt).getTime() - Date.now()) / DAY)
  }));

  return { alerts, grounds, deadlines, generatedAt: new Date().toISOString() };
}

function buildGround(
  ruleId: string, relevance: Relevance, satisfiedPredicates: string[],
  c: CaseData, provisions: ProvisionT[], out: GroundItem[]
) {
  const rule = RULES.find(r => r.id === ruleId);
  if (!rule) return;
  out.push({
    id: `DG-${ruleId}`,
    ruleId,
    rule,
    relevance, // relevance to stated facts — NOT a legal determination (PRD 5.5 AC2)
    satisfiedPredicates,
    law: c.caseType,
    citations: resolveAll(rule.refs, provisions),
    needsReview: relevance === 'high'
  });
}
