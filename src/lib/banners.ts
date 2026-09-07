// Mandatory legal banner texts — PRD v2.1 §5.6 AC3, §5.8 AC2/AC4, §6.6, §9.3, Appendix D.
// BANNER_VERSION is embedded in every Acknowledgment record for auditability.
export const BANNER_VERSION = 'v2.1';

// Short, always-visible disclaimer (neutral, educational framing — Change 1)
export const DISCLAIMER_AR =
  'هذه المنصة تقدّم معلومات قانونية عامة ومحتوى تعليميًا لتعزيز الثقافة الإجرائية، وليست استشارة قانونية لحالتك ولا بديلًا عن المحامي. جميع المخرجات لغة محايدة وتتطلب مراجعة بشرية.';
export const DISCLAIMER_EN =
  'This platform provides general legal information and educational content to support procedural literacy. It is not legal advice for your case and does not replace a lawyer. All outputs use neutral language and require human review.';

// Discussion-draft cover notice — bold, untruncated, on every page (PRD 5.6 AC3 / 6.6)
export const DRAFT_COVER_AR =
  'هذه مسودة نقاش تعليمية وُلِّدت آليًا انطلاقًا من معلومات قانونية عامة. هي ليست استشارة قانونية، ولم يراجعها محامٍ، ولا يجوز إيداعها أمام أي محكمة أو جهة دون مراجعة قانونية مستقلة.';
export const DRAFT_COVER_EN =
  'This is an educational discussion draft generated from general legal information. It is not legal advice, has not been reviewed by a lawyer, and must not be filed with any court without independent legal review.';

// Per-view non-dismissible banner for every ground explanation (PRD 5.5 AC3)
export const GROUND_BANNER_AR =
  'هذه معلومة قانونية عامة تشرح ما تتطلبه القاعدة عادةً، وليست تحديدًا لانطباقها على قضيتك — يجب أن يؤكد المحامي ذلك.';
export const GROUND_BANNER_EN =
  'This is general legal information about what the rule usually requires, not a determination that it applies to your case — a lawyer must confirm.';

// Defamation-risk warning — shown before generation begins AND again at export (PRD 5.8 AC2)
export const DEFAMATION_AR =
  'تحذير مسؤولية: الإبلاغ عن وقائع لم تثبت قد يعرّضك لمسؤولية القذف والتشهير. أرفق مستندات موثّقة فقط، واتّسم بالدقة والموضوعية، ولا تُطلق اتهامات نهائية. مسودتنا تعليمية للنقاش مع محامٍ أو جهة مساندة قبل أي تقديم.';
export const DEFAMATION_EN =
  'Responsibility warning: reporting unproven allegations may expose you to defamation liability. Attach only verified documents, stay factual and neutral, and avoid conclusive accusations. This draft is educational — bring it to a lawyer or supporting organisation before any submission.';

// Export-time acknowledgment text — checkbox + re-displayed banner at every export (PRD 5.6 AC4)
export const EXPORT_ACK_AR =
  'أُقرّ بأنني اطلعت على تنبيه أن هذه المادة معلومات قانونية عامة/مسودة نقاش تعليمية، أنها ليست استشارة قانونية لحالتي، أنها لم يراجعها محامٍ، وأنني سأراجعها مع محامٍ مؤهل قبل أي استخدام.';
export const EXPORT_ACK_EN =
  'I acknowledge that this material is general legal information / an educational discussion draft; that it is not legal advice for my case; that it has not been reviewed by a lawyer; and that I will review it with a qualified lawyer before any use.';

// Cooling-off notice (PRD 5.8 AC4)
export const COOLING_OFF_AR =
  'تُطبَّق فترة تهدئة إلزامية (24 ساعة) على مسودات البلاغات المهنية/النزاهة قبل السماح بالتصدير، وتُعرض تحذيرات التشهير مجددًا، وتُحوَّل المسودة لطابور مراجعة بشري عند توفّر شريك دعم.';
export const COOLING_OFF_EN =
  'A mandatory 24-hour cooling-off period applies to misconduct/Nazaha discussion drafts before export; the defamation warning is displayed again, and the draft is routed to a human review queue where a support partner exists.';

// UPL boundary statement (PRD 9.3) — surfaced in the app
export const UPL_WILLNOT_AR = [
  'لا نختار أو نوصي باستراتيجية قانونية لحالتك.',
  'لا نجزم بأن أسباب الرفض تنطبق على قضيتك أو أن الدعوى ستنجح أو تفشل.',
  'لا نُعِدّ مستندات يُعتقد أنها جاهزة للإيداع، ولا نوجّهك لإيداع مسودة كأنها مُراجَعة.',
  'لا نقدّم أي شيء نيابةً عنك لأي محكمة أو جهة.',
  'لا نستبدل المحامي في أي نص داخل التطبيق أو مخرجاته.'
];
export const UPL_WILLNOT_EN = [
  'We do not select or recommend a legal strategy for your case.',
  'We never assert that a specific ground applies to your case, or that a case will succeed or fail.',
  'We do not prepare documents represented as ready to file, nor instruct filing a draft as if reviewed.',
  'We do not submit anything to any court or authority on your behalf.',
  'We are not a substitute for a lawyer anywhere in the app or its outputs.'
];

export const exportAckBilingual = () =>
  `${EXPORT_ACK_AR}\n${EXPORT_ACK_EN}`;

export const draftCoverBilingual = () =>
  `${DRAFT_COVER_AR}\n${DRAFT_COVER_EN}`;
