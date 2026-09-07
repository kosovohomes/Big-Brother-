// Shared domain types (PRD v2.1 compliant shapes).

export type Lang = 'ar' | 'en';
export type Severity = 'high' | 'medium' | 'low';
export type Relevance = 'high' | 'medium' | 'low';
export type CaseType = 'civil' | 'criminal' | 'family';

export interface SessionPayload {
  uid: string;
  email: string;
  name: string;
  orgId: string;
  role: string;
  iat?: number; // issued-at epoch ms (Phase A C-A7 revocation check; absent on pre-Phase-A cookies)
  exp: number; // epoch ms
}

export interface CitationRef {
  lawId: string;
  article: string; // e.g. "33–42"
  ar: string;
  en: string;
}

export interface ResolvedCitation {
  ref: CitationRef;
  provisionId?: string;
  resolved: boolean;   // resolves to an exact LKB entry
  verified: boolean;   // entry passed Phase 0 citation audit
  label: string;       // "unverified — flagged for legal review" when not verified
}

export interface AlertItem {
  id: string;
  ruleId: string;
  severity: Severity;
  ar: string;
  en: string;
  articles: string[];
  citations: ResolvedCitation[];
  evidence: string;
}

export interface GroundItem {
  id: string;
  ruleId: string;
  rule?: RuleDef;
  relevance: Relevance; // relevance to user's stated facts — NOT a legal determination (PRD 5.5 AC2)
  satisfiedPredicates: string[];
  law: CaseType;
  citations: ResolvedCitation[];
  needsReview: boolean;
}

export interface DeadlineItem {
  id: string;
  titleAr: string;
  titleEn: string;
  dueAt: string;
  kind: 'appeal' | 'opposition' | 'session' | 'custom';
  provisionRef?: string;
  sourceEventId?: string;
  urgency: 'overdue' | 'critical' | 'soon' | 'later' | 'done';
  daysLeft: number;
}

export interface EngineResult {
  alerts: AlertItem[];
  grounds: GroundItem[];
  deadlines: DeadlineItem[];
  generatedAt: string;
}

export interface CaseData {
  id: string;
  orgId: string;
  ownerId: string;
  number: string;
  court: string;
  circuit?: string;
  caseType: CaseType;
  subType: string;
  role: string;
  filedAt?: string;
  servedAt?: string;
  opponent?: string;
  opponentPleading?: string;
  subjectName?: string;
  intakeChannel: string;
  events: CaseEventT[];
  documents: DocumentT[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseEventT {
  id: string;
  date: string;
  title: string;
  type: string;
  note?: string;
  appealFiled: boolean;
  defect: boolean;
}

export interface DocumentT {
  id: string;
  name: string;
  hash: string;
  size: number;
  mime?: string;
  hashedAt: string;
  metaRisk: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
  version: number;
  previousId?: string;
}

export interface RuleDef {
  id: string;
  track: CaseType;
  category: string;
  ar: string;
  en: string;
  articles: string[]; // bilingual display strings
  refs: { lawId: string; article: string }[]; // structured refs for LKB resolution
  predicates: string[];
  vehicle: { ar: string; en: string };
  timing: { ar: string; en: string };
  severity: Severity;
}

export interface ProvisionT {
  id: string;
  lawId: string;
  lawNameAr: string;
  lawNameEn: string;
  articleNo: string;
  amendmentVersion: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  gazetteRef?: string;
  titleAr: string;
  titleEn: string;
  textAr: string;
  textEn: string;
  summaryAr: string;
  summaryEn: string;
  topics: string[];
  verified: boolean;
  verificationNote?: string;
  version: number;
  supersedesId?: string;
  isActive: boolean;
}

export interface AssertionResponse {
  assertionId: number;
  assertion: string;
  kind: string;
  position: { ar: string; en: string };
  basis: { ar: string; en: string };
  articles: string[];
  relief: { ar: string; en: string };
  verified: string; // 'partial' | 'needs-review'
}
