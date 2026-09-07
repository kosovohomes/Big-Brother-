// Discussion Draft builders (PRD §6.6 — reframed per Change 2).
// Nothing here is labeled or positioned as a ready-to-file document. Each
// builder returns a payload that embeds:
//   - the mandatory, bold, untruncated not-legal-advice cover notice
//   - case timeline (table data)
//   - flagged irregularities / ground categories with citations + snippets
//   - point-by-point response table (discussion drafts)
//   - document integrity page (SHA-256 + timestamps)
//   - general relief-category information (never asserted as ready requests)
//   - general public court-registry information
// Case-specific drafts are generated ONLY on explicit user action (5.5 AC6).

import { LAW, PENAL_LAW } from './rules/catalog';
import { draftCoverBilingual } from './banners';
import type { CaseData, EngineResult, ResolvedCitation } from './types';
import { buildResponse, parseAssertions } from './counterReply';

export interface DraftTypeDef {
  id: string;
  ar: string;
  en: string;
  authority: { ar: string; en: string };
  coolingOffHours: number; // 24 for misconduct/nazaha per PRD 5.8 AC4
  reviewRequired: boolean; // routed to human review queue per PRD 5.8 AC4
  defamationWarning: boolean; // shown before generation AND at export (5.8 AC2)
}

export const DRAFT_TYPES: DraftTypeDef[] = [
  { id: 'counter', ar: 'مسودة نقاش بنّية نقطة-بنقطة', en: 'Point-by-Point Discussion Draft', authority: { ar: 'للنقاش مع محامٍ — لا تُودَع', en: 'For discussion with a lawyer — not for filing' }, coolingOffHours: 0, reviewRequired: false, defamationWarning: false },
  { id: 'dismissal', ar: 'نموذج تعليمي لأسباب الرفض/عدم القبول', en: 'Dismissal / Non-Acceptance Ground Educational Template', authority: { ar: 'مادة تعليمية — لا تُودَع', en: 'Educational material — not for filing' }, coolingOffHours: 0, reviewRequired: false, defamationWarning: false },
  { id: 'evidence', ar: 'نموذج تعليمي للطعن في المستندات', en: 'Evidence Challenge Educational Template / Discussion Draft', authority: { ar: 'للنقاش مع محامٍ — لا تُودَع', en: 'For discussion with a lawyer — not for filing' }, coolingOffHours: 0, reviewRequired: false, defamationWarning: false },
  { id: 'misconduct', ar: 'مسودة بلاغ توقف مهني', en: 'Lawyer Misconduct Concern Draft', authority: { ar: 'جمعية المحامين الكويتية / غرفة التأديب — عبر محامٍ', en: 'Kuwait Lawyers Society / Disciplinary Chamber — via a lawyer' }, coolingOffHours: 24, reviewRequired: true, defamationWarning: true },
  { id: 'nazaha', ar: 'مسودة بلاغ تفتيش قضائي/نزاهة', en: 'Judicial Inspection / Nazaha Concern Draft', authority: { ar: 'التفتيش القضائي / هيئة مكافحة الفساد — عبر محامٍ أو جهة دعم', en: 'Judicial Inspection / Anti-Corruption Authority — via a lawyer or support org' }, coolingOffHours: 24, reviewRequired: true, defamationWarning: true },
  { id: 'combined', ar: 'ملخص تعليمي مشترك', en: 'Combined Educational Summary', authority: { ar: 'مادة تعليمية — لا تُودَع', en: 'Educational material — not for filing' }, coolingOffHours: 0, reviewRequired: false, defamationWarning: false }
];

export const getDraftType = (id: string) => DRAFT_TYPES.find(t => t.id === id);

export interface DraftPayload {
  cover: { ar: string; en: string };
  type: DraftTypeDef;
  law: { id: string; ar: string; en: string };
  caseSummary: Record<string, string>;
  timeline: { date: string; title: string; type: string; note?: string }[];
  alerts: { id: string; severity: string; ar: string; en: string; articles: string[]; citations: ResolvedCitation[] }[];
  grounds: { ruleId: string; relevance: string; ar: string; en: string; vehicle: { ar: string; en: string }; timing: { ar: string; en: string }; citations: ResolvedCitation[] }[];
  pointByPoint?: {
    assertionId: number; assertion: string; kind: string;
    position: { ar: string; en: string }; basis: { ar: string; en: string };
    articles: string[]; relief: { ar: string; en: string }; verified: string;
  }[];
  integrity: { name: string; hash: string; hashedAt: string; version: number }[];
  reliefCategories: { ar: string; en: string };
  registryInfo: { ar: string; en: string };
  generatedAt: string;
  bannerVersion: string;
}

export function buildDraftPayload(
  typeId: string, caseData: CaseData, engineResult: EngineResult
): DraftPayload | null {
  const type = getDraftType(typeId);
  if (!type) return null;
  const law = LAW[caseData.caseType];
  const includeP2P = typeId === 'counter' || typeId === 'combined';

  const assertions = includeP2P ? parseAssertions(caseData.opponentPleading) : [];
  const pointByPoint = assertions.map(a => buildResponse(a, caseData));

  return {
    cover: { ar: draftCoverBilingual(), en: draftCoverBilingual() },
    type,
    law,
    caseSummary: {
      number: caseData.number || '—', court: caseData.court || '—', circuit: caseData.circuit || '—',
      caseType: caseData.caseType, subType: caseData.subType, role: caseData.role,
      opponent: caseData.opponent || '—',
      subject: caseData.subjectName || '—', intake: caseData.intakeChannel
    },
    timeline: (caseData.events || []).map(e => ({ date: e.date, title: e.title, type: e.type, note: e.note || '' })),
    alerts: (engineResult.alerts || []).filter(a => a.severity !== 'low').map(a => ({
      id: a.id, severity: a.severity, ar: a.ar, en: a.en, articles: a.articles, citations: a.citations
    })),
    grounds: (engineResult.grounds || []).filter(g => g.relevance !== 'low' && g.rule).map(g => ({
      ruleId: g.ruleId,
      relevance: g.relevance,
      ar: g.rule!.ar, en: g.rule!.en,
      vehicle: g.rule!.vehicle,
      timing: g.rule!.timing,
      citations: g.citations
    })),
    pointByPoint: includeP2P ? pointByPoint : undefined,
    integrity: (caseData.documents || []).map(d => ({ name: d.name, hash: d.hash, hashedAt: d.hashedAt, version: d.version })),
    reliefCategories: {
      ar: 'فئات طلبات معممة تُناقش عادةً في هذا النوع من القضايا (معلومات عامة وليست طلبات جاهزة للإيداع): طلب عدم القبول شكليًا، طلب الرفض لعدم الإثبات، طلب بطلان إجراء، طلب وقف/تعديل تنفيذ عند الاقتضاء.',
      en: 'General categories of relief typically discussed in matters of this type (general information, NOT ready-to-file requests): formal non-acceptance, dismissal for non-proof, nullity of a procedural step, and, where appropriate, suspension or adjustment of execution.'
    },
    registryInfo: {
      ar: 'معلومات عامة: تُقدَّم الملفات عادةً إلى قلم المحكمة المختصة خلال ساعات الدوام الرسمي، مع صور الهويات وعدد نسخ يوافق عدد الخصوم، وتُدفع الرسوم المقررة. هذه معلومات عامة عن الإجراءات وليست تعليمات إيداع لهذه المسودة.',
      en: 'Public information: filings are generally submitted to the competent court registry during official hours, with ID copies and copies matching the number of parties, and prescribed fees paid. This is general procedural information, NOT filing instructions for this draft.'
    },
    generatedAt: new Date().toISOString(),
    bannerVersion: 'v2.1'
  };
}

export const FORGERY_LAW_REF = PENAL_LAW;
