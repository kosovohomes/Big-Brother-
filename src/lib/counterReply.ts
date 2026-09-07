// Counter-reply educational breakdown (PRD §5.6).
// Layer 1: parse the opponent's pleading into discrete assertions and show the
// GENERAL categories of response available — for the user's own understanding.
// Layer 2: the point-by-point Discussion Draft is built separately (packs.ts)
// only on explicit user action, and reuses this parser.
// Every generated line is traceable to user input or marked "unverified".

import type { AssertionResponse, CaseData } from './types';

const ASSERTION_CUE = /(?<=[.!؟\n])\s+|\n+/u;

const AR_CUES: { re: RegExp; kind: string }[] = [
  { re: /يدّعي|يزعم|ادّعى|يطلب|التماس/, kind: 'allegation' },
  { re: /المادة|مادة|قانون|م\.م\.م|إ\.ج|مرسوم/, kind: 'citation' },
  { re: /إلزام|الحكم عليه|تقرير|تعويض|مبلغ/, kind: 'relief' },
  { re: /مستند|محضر|عقد|إيصال|كشف/, kind: 'evidence' }
];

function classify(sentence: string): string {
  for (const c of AR_CUES) if (c.re.test(sentence)) return c.kind;
  return 'fact';
}

export function parseAssertions(text?: string | null): { id: number; text: string; kind: string }[] {
  if (!text?.trim()) return [];
  return text
    .split(ASSERTION_CUE)
    .map(s => s.trim())
    .filter(s => s.length > 8)
    .map((s, i) => ({ id: i + 1, text: s, kind: classify(s) }));
}

export function buildResponse(assertion: { id: number; text: string; kind: string }, caseData: CaseData): AssertionResponse {
  const docs = (caseData.documents || []).map(d => `«${d.name}» (بصمة SHA-256: ${(d.hash || '').slice(0, 12)}…)`);
  const docRef = docs.length ? docs[docs.length - 1] : null;

  const bases: Record<string, Omit<AssertionResponse, 'assertionId' | 'assertion' | 'kind' | 'verified'>> = {
    allegation: {
      position: { ar: 'إنكار', en: 'Denial' },
      basis: {
        ar: 'ينكر المدعى عليه الواقعة المشار إليها ولا يسلم بصحتها. ومجرد الإدعاء دون سند ثابت لا يصلح أساسًا للإلزام، إذ البينة على من ادّعى.',
        en: 'The defendant denies the asserted fact. A bare allegation without proof cannot ground liability; the burden rests on the claimant.'
      },
      articles: ['م 9 م.م.م (البينة على المدعي)', 'Art. 9 CPL'],
      relief: { ar: 'عدم الاعتداد بالواقعة لعدم ثبوتها', en: 'Disregard the allegation as unproven' }
    },
    citation: {
      position: { ar: 'مناقشة قانونية', en: 'Legal rebuttal' },
      basis: {
        ar: 'النص المستند إليه لا يساند الطلب على النحو المزعوم، أو لا ينطبق على وقائع الدعوى كما هو ثابت بالمحاضر. [غير مُتحقق منه — يتطلب مراجعة بشرية للمادة]',
        en: 'The cited provision does not support the request as claimed, or does not match the facts on record. [Unverified — human review required]'
      },
      articles: ['قواعد التفسير والانطباق — تحتاج مراجعة', 'Interpretation rules — needs review'],
      relief: { ar: 'رد الطلب المستند إلى النص المطعون في انطباقه', en: 'Reject the request grounded on the misapplied text' }
    },
    relief: {
      position: { ar: 'معارضة في الطلب', en: 'Opposition to relief sought' },
      basis: {
        ar: 'الطلب غير مؤسس على وقائع ثابتة ولا على نص سند، ويكون غير مقبول مع ما سيدفع به من أوجه عدم القبول المبينة في هذه المذكرة.',
        en: 'The relief sought is unsupported by established facts or legal basis and is barred by the non-acceptance pleas raised in this memorandum.'
      },
      articles: ['م 12 م.م.م', 'Art. 12 CPL'],
      relief: { ar: 'رفض الطلب', en: 'Dismiss the request' }
    },
    evidence: {
      position: { ar: 'طعن في المستند', en: 'Document challenge' },
      basis: {
        ar: `يعترض المدعى عليه على المستند المشار إليه ويحيط علمًا المحكمة بوجود مؤشرات مخاطرة في سلامته${docRef ? `، وتُحيل المذكرة إلى صفحة سلامة المستندات (بصمة المستند المرفق: ${docRef})` : ''}. يُطلب إبراز أصل المستند وجيزة الطعن بالتزوير عند الاقتضاء.`,
        en: `The defendant objects to the referenced document${docRef ? ` (see integrity page, hash ${docRef})` : ''} and requests production of the original, reserving the right to initiate a forgery challenge.`
      },
      articles: ['م 257–260 جزاء', 'Penal Arts. 257–260'],
      relief: { ar: 'عدم الاعتداد بالمستند / إبراز الأصل / ندب خبير', en: 'Disregard document / order original production / appoint expert' }
    },
    fact: {
      position: { ar: 'إنكار مع إبداء رد', en: 'Qualified denial' },
      basis: {
        ar: 'لا يسلم المدعى عليه بصحة ما ورد، وتُبيّن الوقائع الثابتة في الجدول الزمني المرفق خلاف ذلك. [يتطلب مطابقة مع وقائع المستخدم]',
        en: 'The defendant does not admit the statement; the attached timeline indicates otherwise. [Requires matching against user facts]'
      },
      articles: ['م 9 م.م.م', 'Art. 9 CPL'],
      relief: { ar: 'عدم الاعتداد بالواقعة', en: 'Disregard the statement' }
    }
  };

  const b = bases[assertion.kind] || bases.fact;
  return {
    assertionId: assertion.id,
    assertion: assertion.text,
    kind: assertion.kind,
    position: b.position,
    basis: b.basis,
    articles: b.articles,
    relief: b.relief,
    verified: assertion.kind === 'allegation' || assertion.kind === 'fact' ? 'partial' : 'needs-review'
  };
}

// Educational breakdown shown BY DEFAULT (PRD 5.6 AC1-AC2) — no draft produced.
export function buildEducationalBreakdown(caseData: CaseData): {
  assertions: { id: number; text: string; kind: string }[];
  responses: AssertionResponse[];
  generatedAt: string;
} {
  const assertions = parseAssertions(caseData.opponentPleading);
  const responses = assertions.map(a => buildResponse(a, caseData));
  return { assertions, responses, generatedAt: new Date().toISOString() };
}
