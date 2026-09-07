// Declarative, versioned rule catalogue (PRD §6.2 / §5.5 / Appendix A).
// Tracks: civil (execution/debt), criminal (misdemeanours), family (personal status).
// EVERY rule carries structured refs resolved against the Legal Knowledge Base
// (§6.3a) — the LKB is the sole citation source. All seed provisions remain
// verified:false pending the Phase 0 citation audit (Change 4), so every
// citation surfaced from these rules is shown with an
// "unverified — flagged for legal review" badge in the UI.

import type { CaseType, RuleDef } from '../types';

export const LAW: Record<CaseType, { id: string; ar: string; en: string }> = {
  civil: { id: '38/1980', ar: 'قانون المرافعات المدنية والتجارية رقم 38 لسنة 1980 وتعديلاته', en: 'Civil & Commercial Procedure Law 38/1980 (as amended)' },
  criminal: { id: '17/1960', ar: 'قانون الإجراءات الجزائية رقم 17 لسنة 1960 وتعديلاته', en: 'Criminal Procedure Law 17/1960 (as amended)' },
  family: { id: '51/1996', ar: 'قانون الأحوال الشخصية رقم 51 لسنة 1996 وتعديلاته', en: 'Personal Status Law 51/1996 (as amended)' }
};
export const PENAL_LAW = { id: '16/1960', ar: 'قانون الجزاء رقم 16 لسنة 1960', en: 'Penal Code 16/1960' };
export const ESERVICE_LAW = { id: '9/2020', ar: 'قانون التبليغات الإلكترونية رقم 9 لسنة 2020', en: 'Electronic Service Law 9/2020' };

// Appeal / opposition windows in days.
// [JUDGMENT CALL per PRD Appendix E-9]: MVP defaults, to be validated by
// lawyer advisors in Phase 0 — family window especially pending verification.
export const WINDOWS: Record<CaseType, { appeal: number; opposition: number }> = {
  civil: { appeal: 40, opposition: 15 },
  criminal: { appeal: 20, opposition: 10 },
  family: { appeal: 30, opposition: 15 }
};

const P = (lawId: string, article: string) => ({ lawId, article });

export const RULES: RuleDef[] = [
  // ===================== CIVIL (original 9 rules preserved) =====================
  {
    id: 'CIV-JUR-001', track: 'civil', category: 'jurisdiction',
    ar: 'انعدام الاختصاص المحلي أو النوعي بالمحكمة المنظورة أمامها الدعوى',
    en: 'Lack of territorial or subject-matter jurisdiction of the court seized with the case',
    articles: ['م 33–42 م.م.م', 'Arts. 33–42 CPL'],
    refs: [P('38/1980', '33-42')],
    predicates: ['عنوان/مقر المدعى عليه خارج دائرة المحكمة', 'نوع النزاع من اختصاص محكمة أخرى'],
    vehicle: { ar: 'دفع بعدم الاختصاص', en: 'Plea of lack of jurisdiction' },
    timing: { ar: 'يجب إثارته قبل الكلام في الموضوع وإلا سقط الحق فيه (مع مراعاة الاختصاص النوعي اللاحق)', en: 'Must be raised before pleading on the merits; subject-matter jurisdiction may be raised at any stage' },
    severity: 'high'
  },
  {
    id: 'CIV-STAND-002', track: 'civil', category: 'standing',
    ar: 'انعدام الصفة أو المصلحة للمدعي في رفع الدعوى',
    en: 'Lack of standing, capacity, or legal interest of the plaintiff',
    articles: ['م 12 م.م.م', 'Art. 12 CPL'],
    refs: [P('38/1980', '12')],
    predicates: ['المدعي ليس صاحب الحق المدعى به', 'لا مصلحة مباشرة وشخصية للمدعي'],
    vehicle: { ar: 'دفع بعدم قبول الدعوى', en: 'Plea of non-acceptance' },
    timing: { ar: 'دفع بعدم القبول يُثار في أي مرحلة من مراحل الدعوى', en: 'May be raised at any stage of the proceedings' },
    severity: 'high'
  },
  {
    id: 'CIV-RESJ-003', track: 'civil', category: 'resjudicata',
    ar: 'سبق الفصل في النزاع بحكم حائز لقوة الشيء المحكوم به',
    en: 'Res judicata — the dispute was already decided by a final judgment',
    articles: ['م 451 م.م.م', 'Art. 451 CPL'],
    refs: [P('38/1980', '451')],
    predicates: ['وجود حكم سابق نهائي في ذات النزاع بين ذات الخصوم'],
    vehicle: { ar: 'دفع بالحجية (سبق الفصل)', en: 'Res judicata plea' },
    timing: { ar: 'يُثار قبل الكلام في الموضوع أو في أي مرحلة', en: 'Before merits or at any stage' },
    severity: 'high'
  },
  {
    id: 'CIV-LIM-004', track: 'civil', category: 'limitation',
    ar: 'انقضاء مدة التقادم المحل للحق المدعى به',
    en: 'Limitation period on the claimed right has expired',
    articles: ['م 172 وما بعدها قانون مدني 67/1976', 'Arts. 172 et seq. Civil Law 67/1976'],
    refs: [P('67/1976', '172')],
    predicates: ['تاريخ استحقاق الدين/الحق معروف', 'مضي المدة القانونية دون مطالبة قاطعة للتقادم'],
    vehicle: { ar: 'دفع بعدم القبول لانقضاء المدة', en: 'Limitation plea of non-acceptance' },
    timing: { ar: 'يجب التمسك به صراحة قبل الحكم في الموضوع', en: 'Must be expressly invoked before judgment on the merits' },
    severity: 'high'
  },
  {
    id: 'CIV-SERV-005', track: 'civil', category: 'service',
    ar: 'بطلان التبليغ أو الإعلان (بما في ذلك التبليغ الإلكتروني)',
    en: 'Nullity of service/notification (including electronic service)',
    articles: ['م 8–26 م.م.م', 'ق 9/2020', 'Arts. 8–26 CPL; Law 9/2020'],
    refs: [P('38/1980', '8-26'), P('9/2020', '1')],
    predicates: ['عدم تطابق بيانات المُبلَّغ به مع بيانات الخصم', 'عدم إثبات التسليم أو القرينة المقررة قانونًا'],
    vehicle: { ar: 'دفع ببطلان إجراءات التبليغ', en: 'Plea of nullity of service' },
    timing: { ar: 'يُثار فور العلم به وقبل الدفاع في الموضوع؛ البطلان المتعلق بالنظام العام لا يسقط', en: 'Raise upon knowledge, before merits defence; public-order nullity does not lapse' },
    severity: 'high'
  },
  {
    id: 'CIV-NULL-006', track: 'civil', category: 'nullity',
    ar: 'بطلان تصرف إجرائي جوهري (مذكرة، محضر، تبليغ) لنقص ركن من أركانه',
    en: 'Nullity of a material procedural act missing a mandatory element',
    articles: ['م 19–24 م.م.م', 'Arts. 19–24 CPL'],
    refs: [P('38/1980', '19-24')],
    predicates: ['تحديد الإجراء المعيب والنص الناقص في أركانه'],
    vehicle: { ar: 'طلب إثارة البطلان', en: 'Motion to declare nullity' },
    timing: { ar: 'قبل الكلام في الموضوع للعيوب القابلة للإسقاط', en: 'Before merits for waivable defects' },
    severity: 'medium'
  },
  {
    id: 'CIV-CAUSE-007', track: 'civil', category: 'cause',
    ar: 'خلو صحيفة الدعوى من بيانات إلزامية أو عدم إظهار سبب الدعوى',
    en: 'Failure to state a cause of action / missing mandatory claim elements',
    articles: ['م 43 م.م.م', 'Art. 43 CPL'],
    refs: [P('38/1980', '43')],
    predicates: ['صحيفة الدعوى لا تتضمن وقائع أو طلبات محددة'],
    vehicle: { ar: 'دفع بعدم القبول لعدم استيفاء الشكل', en: 'Plea of non-acceptance for formal deficiency' },
    timing: { ar: 'قبل التكلم في الموضوع', en: 'Before merits' },
    severity: 'medium'
  },
  {
    id: 'CIV-EXEC-008', track: 'civil', category: 'execution',
    ar: 'انقضاء إجراءات التنفيذ أو بطلان سند التنفيذ أو سداد المحكوم به/صلح',
    en: 'Execution extinction, defective execution instrument, settlement or payment',
    articles: ['م 201 وما بعدها م.م.م', 'Arts. 201 et seq. CPL'],
    refs: [P('38/1980', '201'), P('38/1980', '210')],
    predicates: ['سند التنفيذ ناقص أو منتهي', 'إثبات السداد أو الصلح أو مضي مدة انقضاء التنفيذ'],
    vehicle: { ar: 'منازعة موضوعية أو وقتية في التنفيذ', en: 'Execution objection' },
    timing: { ar: 'قبل إتمام إجراء التنفيذ المعتدى عليه', en: 'Before completion of the challenged execution step' },
    severity: 'high'
  },
  {
    id: 'CIV-ABUSE-009', track: 'civil', category: 'abuse',
    ar: 'استغلال الإجراءات للمماطلة أو الكيدية (نمط تأجيلات متكرر)',
    en: 'Abuse of process / dilatory tactics pattern (repeated adjournments)',
    articles: ['م 96 م.م.م (التأجيل لجلسة واحدة)', 'Art. 96 CPL'],
    refs: [P('38/1980', '96')],
    predicates: ['ثلاث تأجيلات أو أكثر بلا سبب مشروع', 'مستندات تُقدَّم في اللحظة الأخيرة بشكل متكرر'],
    vehicle: { ar: 'طلب اللجوء للمحكمة بسرعة الفصل ومواجهة المماطلة', en: 'Request for expeditious adjudication' },
    timing: { ar: 'في أي جلسة', en: 'At any session' },
    severity: 'medium'
  },
  {
    id: 'CRIM-JUR-001', track: 'criminal', category: 'jurisdiction',
    ar: 'انعدام اختصاص المحكمة الجزائية بنوع الجريمة أو مكانها',
    en: 'Lack of criminal jurisdiction (subject-matter or territorial)',
    articles: ['م 5–16 إ.ج', 'Arts. 5–16 CrCL'],
    refs: [P('17/1960', '5-16')],
    predicates: ['الوقائع تقع خارج الاختصاص المحلي', 'الجريمة من اختصاص محكمة أخرى درجة/نوعًا'],
    vehicle: { ar: 'دفع بعدم الاختصاص', en: 'Jurisdiction plea' },
    timing: { ar: 'قبل الموضوع، والاختصاص النوعي من النظام العام', en: 'Before merits; subject-matter jurisdiction is public order' },
    severity: 'high'
  },
  {
    id: 'CRIM-PRES-002', track: 'criminal', category: 'prescription',
    ar: 'انقضاء الدعوى العامة بالتقادم أو سقوط العقوبة بالتقادم',
    en: 'Prescription of the public action or of the penalty',
    articles: ['م 10–15 إ.ج', 'Arts. 10–15 CrCL'],
    refs: [P('17/1960', '10-15')],
    predicates: ['مضي المدة القانونية دون إجراء قاطع للتقادم'],
    vehicle: { ar: 'دفع بانقضاء الدعوى بالتقادم', en: 'Prescription plea' },
    timing: { ar: 'من النظام العام — يُثار في أي مرحلة', en: 'Public order — may be raised at any stage' },
    severity: 'high'
  },
  {
    id: 'CRIM-COMPL-003', track: 'criminal', category: 'complaint',
    ar: 'انعدام الشكوى أو الإذن المطلوب في الجرائم التي يشترط القانون فيهما',
    en: 'Absence of the required complaint or authorisation for offences where mandated',
    articles: ['م 12، 16 إ.ج', 'Arts. 12, 16 CrCL'],
    refs: [P('17/1960', '12'), P('17/1960', '16')],
    predicates: ['الجريمة من الجرائم التي لا تُتابع إلا بشكوى/إذن ولم تُقدَّم'],
    vehicle: { ar: 'دفع بعدم القبول لانعدام الشكوى', en: 'Plea of non-acceptance for absence of complaint' },
    timing: { ar: 'قبل الموضوع', en: 'Before merits' },
    severity: 'high'
  },
  {
    id: 'CRIM-DOUBLE-004', track: 'criminal', category: 'doublejeopardy',
    ar: 'سبق الحكم البات في ذات الواقعة (حجية الشيء المحكوم فيه الجزائي)',
    en: 'Double jeopardy — final judgment previously rendered on the same facts',
    articles: ['م 15 إ.ج', 'Art. 15 CrCL'],
    refs: [P('17/1960', '15')],
    predicates: ['حكم جزائي بات سابق على ذات الوقائع'],
    vehicle: { ar: 'دفع بحجية الشيء المحكوم فيه', en: 'Double-jeopardy plea' },
    timing: { ar: 'من النظام العام', en: 'Public order' },
    severity: 'high'
  },
  {
    id: 'CRIM-NULL-005', track: 'criminal', category: 'nullity',
    ar: 'بطلان إجراءات التحقيق أو أمر الإحالة لعيب شكلي جوهري',
    en: 'Nullity of investigation or referral order for a material formal defect',
    articles: ['م 167 وما بعدها إ.ج', 'Arts. 167 et seq. CrCL'],
    refs: [P('17/1960', '167')],
    predicates: ['غياب دفاع المتهم في إجراء جوهري', 'إجراء لم يُتخذ وفق الأوضاع المقررة'],
    vehicle: { ar: 'دفع ببطلان الإجراء', en: 'Nullity plea' },
    timing: { ar: 'فور ظهور البطلان وقبل دخول الموضوع', en: 'Upon discovery, before merits' },
    severity: 'medium'
  },

  // ============ FAMILY — Personal Status Law 51/1996 (14 new rules) ============
  // Every family citation is explicitly unverified pending the Phase 0 audit
  // (PRD Change 4 / Appendix E-8): article numbers below are working references.
  {
    id: 'FAM-JUR-001', track: 'family', category: 'jurisdiction',
    ar: 'انعدام اختصاص محكمة الأسرة بالنزاع أو خروجه عن نطاق الأحوال الشخصية',
    en: 'Lack of Family Court competence over the dispute or outside personal-status scope',
    articles: ['ق 51/1996 (الاختصاص) — غير مُتحقق منه', 'Law 51/1996 (competence) — unverified'],
    refs: [P('51/1996', '1')],
    predicates: ['النزاع ليس من نزاعات الأحوال الشخصية المقررة', 'ازدواجية اختصاص مع محكمة عامة'],
    vehicle: { ar: 'دفع بعدم الاختصاص', en: 'Plea of lack of jurisdiction' },
    timing: { ar: 'قبل الكلام في الموضوع', en: 'Before pleading on the merits' },
    severity: 'high'
  },
  {
    id: 'FAM-MARR-002', track: 'family', category: 'proof',
    ar: 'عدم إثبات عقد الزواج أو نقص بياناته الإلزامية',
    en: 'Failure to prove the marriage contract or missing mandatory contract elements',
    articles: ['م 21 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 21 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '21-25')],
    predicates: ['غياب وثيقة عقد رسمية أو شهود', 'نقص ركن من أركان العقد (إيجاب، قبول، وكالة)'],
    vehicle: { ar: 'دفع بعدم قبول الدعوى لعدم الإثبات / طلب إثبات العقد', en: 'Non-acceptance for non-proof / motion to prove the contract' },
    timing: { ar: 'قبل الموضوع', en: 'Before merits' },
    severity: 'high'
  },
  {
    id: 'FAM-DOW-003', track: 'family', category: 'dower',
    ar: 'نزاع المهر: عدم بيان المهر أو ثبوت قبض جزء منه أو اشتراط البقاء',
    en: 'Dower dispute: unspecified dower, part received, or a condition attached',
    articles: ['م 46 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 46 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '46-56')],
    predicates: ['عدم نص العقد على مهر مسمى', 'إثبات قبض (عربون) أو عدمه في المحضر'],
    vehicle: { ar: 'دفع/منازعة في المهر المستحق', en: 'Dower defence / counter-claim' },
    timing: { ar: 'في أي مرحلة قبل الحكم', en: 'At any stage before judgment' },
    severity: 'medium'
  },
  {
    id: 'FAM-MAINT-004', track: 'family', category: 'maintenance',
    ar: 'عدم استحقاق النفقة المطالبة بها أو سقوطها بالتنازل/الكفاءة',
    en: 'Maintenance not established for the claimant, or lapsed by waiver/capacity',
    articles: ['م 78 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 78 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '78-87')],
    predicates: ['عدم إثبات رابطة أو حالة الاستحقاق', 'إثبات تنازل أو أسباب سقوط (عصيان، كفاءة)'],
    vehicle: { ar: 'دفع بعدم القبول/عدم الإثبات وطلب الرفض', en: 'Non-acceptance / non-proof plea seeking dismissal' },
    timing: { ar: 'قبل الموضوع؛ النفقة السابقة لها مدة محددة', en: 'Before merits; arrears carry a bounded look-back period' },
    severity: 'high'
  },
  {
    id: 'FAM-MAINT-005', track: 'family', category: 'maintenance',
    ar: 'انقضاء دعوى نفقة القربى بشروطها (عدم القدرة، الإرث، حد المدة)',
    en: 'Relatives-maintenance claim barred by its conditions (inability, inheritance share, period cap)',
    articles: ['م 88 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 88 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '88-95')],
    predicates: ['المطالب غير وارث أو حصته لا تكفي', 'مضي المدة المقررة على النفقة السابقة'],
    vehicle: { ar: 'دفع بعدم القبول', en: 'Plea of non-acceptance' },
    timing: { ar: 'قبل الموضوع', en: 'Before merits' },
    severity: 'medium'
  },
  {
    id: 'FAM-DIV-006', track: 'family', category: 'divorce',
    ar: 'نزاع الطلاق: عدم إثبات صيغة الطلاق أو الاختلاف بين رجعي وبائن',
    en: 'Divorce dispute: unproven formula or revocable/irrevocable character conflict',
    articles: ['م 93 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 93 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '93-110')],
    predicates: ['غياب إثبات وقوع الطلاق أو صورته', 'تعارض بين رجعي وبائن بينة أو بونة'],
    vehicle: { ar: 'دفع بثبوت الطلاق/بونته ومآلاته', en: 'Plea on divorce occurrence and character' },
    timing: { ar: 'قبل الموضوع', en: 'Before merits' },
    severity: 'high'
  },
  {
    id: 'FAM-KHUL-007', track: 'family', category: 'divorce',
    ar: 'خلع: عدم اتفاق على العِوض أو مطالبة زائدة عن المهر المقدم',
    en: "Khul': no agreed compensation or a claim exceeding the advanced dower",
    articles: ['م 111 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 111 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '111-113')],
    predicates: ['غياب اتفاق العِوض أو ردها له', 'الطلب يتجاوز ما قدمته الزوجة من مهر'],
    vehicle: { ar: 'دفع في قيمة/وجوب العوض', en: 'Defence on compensation amount/obligation' },
    timing: { ar: 'قبل إتمام القضاء في الخلع', en: 'Before the khul ruling is completed' },
    severity: 'medium'
  },
  {
    id: 'FAM-DIS-008', track: 'family', category: 'divorce',
    ar: 'دعوى الشقاق: إغفال إجراء الصلح أو عدم إثبات النزاع والضرر',
    en: 'Judicial dissolution for discord: skipped reconciliation step or unproven discord/harm',
    articles: ['م 120 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 120 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '120-126')],
    predicates: ['عدم ورود محاولة صلح/تحكيم في الإجراءات', 'لا بينة على النزاع والضرر'],
    vehicle: { ar: 'دفع بعدم القبول لسقوط أحد أركان الدعوى', en: 'Non-acceptance plea for a missing element' },
    timing: { ar: 'قبل الموضوع أو ضمنه بحسب الإجراء', en: 'Before or within merits per procedure' },
    severity: 'medium'
  },
  {
    id: 'FAM-IDDA-009', track: 'family', category: 'status',
    ar: 'مسائل العِدة: قيامها أو انقضاؤها وأثرها على الإجراءات',
    en: "Waiting-period ('idda) issues: observance/expiry and procedural effects",
    articles: ['م 128 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 128 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '128-134')],
    predicates: ['طعن قبل انقضاء العدة في صورة الطلاق الرجعي', 'اختلاف في حساب المدة'],
    vehicle: { ar: 'دفع شكلي مرتبط بالعدة', en: 'Formal plea tied to the waiting period' },
    timing: { ar: 'حسب واقعة العدة', en: 'Depending on the waiting-period facts' },
    severity: 'medium'
  },
  {
    id: 'FAM-CUST-010', track: 'family', category: 'custody',
    ar: 'الحضانة: عدم أهلية الحاضن أو بلوغ المحضون سن الترخيص أو تغيّر الظروف',
    en: 'Custody: custodian ineligibility, child reaching the statutory age, or changed circumstances',
    articles: ['م 187 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 187 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '187-201')],
    predicates: ['زواج حاضنة غير ملائم أو إخلال جسيم', 'بلوغ المحضون السن المقررة أو تغير مصلحته'],
    vehicle: { ar: 'دعوى استرداد/نقل الحضانة', en: 'Custody restoration/transfer action' },
    timing: { ar: 'دعوى مستقلة في أي وقت يتغير فيه الوضع', en: 'Independent action whenever circumstances change' },
    severity: 'high'
  },
  {
    id: 'FAM-VISIT-011', track: 'family', category: 'custody',
    ar: 'المشاهدة: منعها دون مسوغ أو ضيق غير مبرر بما يضر بالمحضون',
    en: 'Visitation: unjustified denial or undue restriction harming the child’s interest',
    articles: ['ق 51/1996 (المشاهدة) — غير مُتحقق منه', 'L.51/1996 (visitation) — unverified'],
    refs: [P('51/1996', '200')],
    predicates: ['منع مشاهدة دون حكم أو مسوغ مشروع', 'شروط مشاهدة مقيدة بخلاف مصلحة المحضون'],
    vehicle: { ar: 'طلب تنظيم المشاهدة وإنفاذها', en: 'Motion to regulate and enforce visitation' },
    timing: { ar: 'في أي وقت', en: 'At any time' },
    severity: 'medium'
  },
  {
    id: 'FAM-FASID-012', track: 'family', category: 'nullity',
    ar: 'فساد عقد الزواج وأثره (بطلان/انفساخ) وحكم القابل للفساد',
    en: 'Corrupt marriage and its effects (nullity/separation) vs voidable marriage',
    articles: ['م 61 وما بعدها ق 51/1996 — غير مُتحقق منه', 'Arts. 61 et seq. L.51/1996 — unverified'],
    refs: [P('51/1996', '61-70')],
    predicates: ['ركن مفقود من أركان العقد أو مانع شرعي', 'تمييز بين الفاسد والقابل للفساد وآثاره'],
    vehicle: { ar: 'دعوى بطلان/انفساخ', en: 'Nullity/separation action' },
    timing: { ar: 'حسب نوع العيب (متحقق أو قابل للإسقاط)', en: 'Per defect type (inherent vs waivable)' },
    severity: 'high'
  },
  {
    id: 'FAM-APPEAL-013', track: 'family', category: 'deadlines',
    ar: 'فوات ميعاد الطعن في أحكام الأحوال الشخصية (ميعاد إجرائي غير مُتحقق منه)',
    en: 'Expired appeal window in personal-status judgments (procedural window, unverified)',
    articles: ['الإجراءات أمام محاكم الأسرة — يُتحقق من الميعاد', 'Family-court procedure — window under verification'],
    refs: [P('51/1996', '215')],
    predicates: ['حكم صادر ومضي الميعاد دون طعن'],
    vehicle: { ar: 'التحقق من الميعاد قبل أي خطوة واستشارة محامٍ فورًا', en: 'Verify the window before any step; seek immediate lawyer advice' },
    timing: { ar: 'يُحتسب من النطق أو النشر وفق القانون', en: 'Counted from pronouncement or publication per law' },
    severity: 'high'
  },
  {
    id: 'FAM-EXEC-014', track: 'family', category: 'execution',
    ar: 'تنفيذ أحكام الأسرة: سند النفقة، الحبس التنفيذي، وحجوزات التنفيذ',
    en: 'Family-judgment execution: maintenance bond, execution imprisonment, attachment limits',
    articles: ['ق 51/1996 (التنفيذ) — غير مُتحقق منه', 'L.51/1996 (execution) — unverified'],
    refs: [P('51/1996', '205')],
    predicates: ['حكم نفقة نهائي غير منفذ', 'طعن في إجراءات التنفيذ أو أوامر الحبس'],
    vehicle: { ar: 'منازعة في إجراءات التنفيذ أو طلب تنفيذ', en: 'Execution objection or enforcement motion' },
    timing: { ar: 'وفق أحكام التنفيذ المقررة', en: 'Per the applicable execution rules' },
    severity: 'high'
  }
];

// Cross-cutting forgery / evidence rules (Penal Code 257–260)
export const FORGERY_RULE = {
  ar: 'مخالفة أحكام تجريم التزوير (م 257–260 جزاء كويتي) — تحفيز طلب نفى/استبعاد المستند والاستدلال السلبي',
  en: 'Forgery offences (Penal Code Arts. 257–260) — supports document challenge, exclusion request, and adverse inference'
};

export const EVENT_TYPES = [
  { value: 'filing', ar: 'قيد الدعوى', en: 'Filing' },
  { value: 'service', ar: 'تبليغ', en: 'Service' },
  { value: 'service-issue', ar: 'إشكال تبليغ', en: 'Service problem' },
  { value: 'session', ar: 'جلسة', en: 'Session' },
  { value: 'adjournment', ar: 'تأجيل', en: 'Adjournment' },
  { value: 'submission', ar: 'مذكرة/مستند مقدَّم', en: 'Submission' },
  { value: 'late-submission', ar: 'تقديم في اللحظة الأخيرة', en: 'Last-minute submission' },
  { value: 'judgment', ar: 'حكم', en: 'Judgment' },
  { value: 'prior-judgment', ar: 'حكم سابق في النزاع ذاته', en: 'Prior judgment (same dispute)' },
  { value: 'standing-issue', ar: 'إشكال في الصفة/المصلحة', en: 'Standing issue' },
  { value: 'claim-defect', ar: 'خلل في صحيفة الدعوى', en: 'Claim-form defect' },
  { value: 'debt-due', ar: 'تاريخ استحقاق الدين/الحق', en: 'Debt due date' },
  { value: 'execution', ar: 'إجراء تنفيذ', en: 'Execution step' },
  { value: 'maintenance-unpaid', ar: 'نفقة غير مدفوعة', en: 'Unpaid maintenance' },
  { value: 'custody-issue', ar: 'إشكال حضانة/مشاهدة', en: 'Custody/visitation issue' },
  { value: 'khul-request', ar: 'طلب خلع', en: "Khul' request" },
  { value: 'marriage-proof-issue', ar: 'إشكال إثبات عقد الزواج', en: 'Marriage-contract proof issue' },
  { value: 'hearing', ar: 'جلسة تحقيق/استماع', en: 'Hearing' },
  { value: 'other', ar: 'أخرى', en: 'Other' }
];
