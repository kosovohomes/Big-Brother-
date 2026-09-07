// Bilingual UI copy — Arabic primary (PRD §7), English secondary.
export type Lang = 'ar' | 'en';
export const tr = (o: { ar: string; en: string }, lang: Lang) => o[lang] ?? o.ar;

export const T = {
  appName: { ar: 'الأخ الكبير', en: 'Big Brother' },
  brandSub: { ar: 'المراقب الإجرائي — معلومات قانونية عامة', en: 'Procedural watchdog — general legal information' },
  disclaimer: {
    ar: 'هذه المنصة تقدّم معلومات قانونية عامة ومحتوى تعليميًا لتعزيز الثقافة الإجرائية، وليست استشارة قانونية لحالتك ولا بديلًا عن المحامي. جميع المخرجات بلغة محايدة وتتطلب مراجعة بشرية.',
    en: 'This platform provides general legal information and educational content to support procedural literacy. It is not legal advice for your case and does not replace a lawyer. All outputs use neutral language and require human review.'
  },
  nav: {
    dashboard: { ar: 'لوحة القضايا', en: 'Dashboard' },
    timeline: { ar: 'الجدول الزمني ورادار المواعيد', en: 'Timeline & Deadline Radar' },
    alerts: { ar: 'التنبيهات الإجرائية', en: 'Procedural Alerts' },
    grounds: { ar: 'فئات أسباب الرفض (تعليمي)', en: 'Dismissal Ground Categories' },
    counter: { ar: 'تحليل مذكرة الخصم', en: 'Opponent Pleading Breakdown' },
    evidence: { ar: 'سجل الأدلة والسلامة', en: 'Evidence Log & Integrity' },
    research: { ar: 'قاعدة المعرفة القانونية', en: 'Legal Knowledge Base' },
    audit: { ar: 'تدقيق المصادر (المرحلة صفر)', en: 'Citation Audit (Phase 0)' },
    drafts: { ar: 'مسودات النقاش والتصدير', en: 'Discussion Drafts & Export' },
    compliance: { ar: 'الامتثال والبيانات', en: 'Compliance & Data' },
    billing: { ar: 'الباقة والاستخدام', en: 'Plan & Usage' }
  },
  severity: {
    high: { ar: 'مرتفع', en: 'High' },
    medium: { ar: 'متوسط', en: 'Medium' },
    low: { ar: 'منخفض', en: 'Low' }
  },
  relevance: {
    high: { ar: 'ملاءمة مرتفعة لوقائعك', en: 'High relevance to your stated facts' },
    medium: { ar: 'ملاءمة متوسطة', en: 'Medium relevance' },
    low: { ar: 'ملاءمة منخفضة', en: 'Low relevance' }
  },
  urgency: {
    overdue: { ar: 'تجاوز الموعد', en: 'Overdue' },
    critical: { ar: 'حرج (≤ 7 أيام)', en: 'Critical (≤ 7 days)' },
    soon: { ar: 'قريب (≤ 30 يومًا)', en: 'Soon (≤ 30 days)' },
    later: { ar: 'لاحقًا', en: 'Later' },
    done: { ar: 'منجز', en: 'Done' }
  },
  draftStatus: {
    DRAFT: { ar: 'مسودة أولية', en: 'Draft' },
    FINALIZED: { ar: 'مُنهائية', en: 'Finalized' },
    IN_REVIEW: { ar: 'في طابور المراجعة البشرية', en: 'In human review queue' },
    RELEASED: { ar: 'مُصرَّح بها من المراجعة', en: 'Released from review' },
    EXPORTED: { ar: 'تم تصديرها', en: 'Exported' }
  },
  login: { ar: 'تسجيل الدخول', en: 'Sign in' },
  register: { ar: 'حساب جديد', en: 'Create account' },
  logout: { ar: 'خروج', en: 'Sign out' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  name: { ar: 'الاسم', en: 'Name' },
  demoAccounts: { ar: 'حسابات تجريبية (كلمة المرور demo1234):', en: 'Demo accounts (password demo1234):' },
  workspaces: { ar: 'مساحة العمل', en: 'Workspace' },
  switchOrg: { ar: 'تبديل مساحة العمل', en: 'Switch workspace' },
  joinByCode: { ar: 'انضم برمز دعوة', en: 'Join by invite code' },
  newCase: { ar: 'قضية جديدة', en: 'New case' },
  generateDraft: { ar: 'توليد مسودة نقاش (خطوة صريحة)', en: 'Generate Discussion Draft (explicit step)' },
  exportDraft: { ar: 'تصدير / تنزيل', en: 'Export / download' },
  finalizeDraft: { ar: 'إنهاء المسودة', en: 'Finalize draft' },
  releaseReview: { ar: 'إقرار من المراجعة', en: 'Release from review' },
  coolingOff: { ar: 'فترة التهدئة الإلزامية', en: 'Mandatory cooling-off' },
  helpNotHelpful: { ar: 'مفيد / غير مفيد', en: 'Helpful / Not helpful' },
  search: { ar: 'ابحث في قاعدة المعرفة…', en: 'Search the Knowledge Base…' },
  unverified: { ar: 'غير مُتحقق منه — بانتظار التدقيق المرجعي', en: 'Unverified — pending citation audit' },
  verified: { ar: 'مُتحقق منه', en: 'Verified' },
  auditQueue: { ar: 'طابور تدقيق الاستشهادات — المرحلة صفر', en: 'Citation audit queue — Phase 0' },
  auditExplain: {
    ar: 'قبل عرض أي استشهاد كـ«مُتحقق منه» يجب أن يراجع محامٍ مرخّص كل مادة مقابل الجريدة الرسمية، ويسجّل أساس التوثيق ومرجع النشر. سجلّ من راجع ومتى ومَبنيًا على ما يُحفظ في سجل التدقيق.',
    en: 'Before any citation can be shown as verified, a licensed lawyer must review each provision against the official gazette and record the basis of sign-off and the gazette reference. Who verified, when, and on what basis is kept in the audit trail.'
  },
  auditReviewBtn: { ar: 'مراجعة وتوثيق', en: 'Review & verify' },
  auditVerifyAction: { ar: 'توثيق', en: 'Verify' },
  auditAmendAction: { ar: 'تعديل (إصدار جديد)', en: 'Amend (new version)' },
  auditDeactivateAction: { ar: 'إيقاف الاستشهاد', en: 'Deactivate' },
  auditReactivateAction: { ar: 'إعادة التنشيط', en: 'Reactivate' },
  auditNoteLabel: { ar: 'أساس التوثيق / ملاحظة المراجعة (إلزامي)', en: 'Verification basis / review note (required)' },
  auditGazetteLabel: { ar: 'مرجع الجريدة الرسمية (كويت اليوم)', en: 'Official gazette reference (Kuwait Al-Youm)' },
  auditEffectiveFrom: { ar: 'سارٍ من', en: 'Effective from' },
  auditAmendTextLabel: { ar: 'النص المُعدّل (عربي)', en: 'Amended text (Arabic)' },
  auditAmendTextEnLabel: { ar: 'النص المُعدّل (إنجليزي)', en: 'Amended text (English)' },
  auditVerifiedBy: { ar: 'وثّقها', en: 'Verified by' },
  auditArchivedToggle: { ar: 'عرض المواد المؤرشفة (المُستبدلة/الموقوفة)', en: 'Show archived (superseded/deactivated)' },
  auditPhase0Done: { ar: 'اكتملت المرحلة صفر: جميع مواد قاعدة المعرفة مُوثّقة من محامٍ.', en: 'Phase 0 complete: every LKB provision is lawyer-verified.' },
  voiceNote: { ar: 'إدخال صوتي للقضية', en: 'Voice-note intake' },
  consentTitle: { ar: 'الموافقة على معالجة البيانات', en: 'Data processing consent' },
  ackCheckbox: {
    ar: 'أفهم وأقرّ أن هذه المادة معلومات قانونية عامة / مسودة نقاش تعليمية، وليست استشارة قانونية، ولم يراجعها محامٍ.',
    en: 'I understand and acknowledge this is general legal information / an educational discussion draft, not legal advice, and has not been reviewed by a lawyer.'
  },
  billingTitle: { ar: 'الباقة والاستخدام', en: 'Plan & usage' },
  billingExplain: {
    ar: 'تُقيّد الباقات سعة الاستخدام والتعاون فقط — ميزات السلامة والامتثال (ختم الأدلة، بوابات الإقرار، تصدير/حذف البيانات، تدقيق المصادر) متاحة في جميع الباقات دائمًا. لا تُحذف بياناتك عند تخفيض الباقة.',
    en: 'Plans only limit capacity and collaboration — safety & compliance features (evidence sealing, acknowledgment gates, data export/delete, citation audit) are always included in every plan. Downgrading never deletes your data.'
  },
  billingCurrent: { ar: 'الباقة الحالية', en: 'Current plan' },
  billingStatus: { ar: 'حالة الاشتراك', en: 'Subscription status' },
  billingRenews: { ar: 'التجديد التالي', en: 'Renews on' },
  billingUsage: { ar: 'الاستخدام مقابل الحدود', en: 'Usage against limits' },
  billingUpgrade: { ar: 'الترقية إلى الاحترافية', en: 'Upgrade to Pro' },
  billingCancel: { ar: 'إلغاء الاشتراك (عودة للمجانية)', en: 'Cancel subscription (back to Free)' },
  billingHistory: { ar: 'سجل الفواتير والعمليات', en: 'Billing history' },
  billingPlans: { ar: 'مقارنة الباقات', en: 'Compare plans' },
  billingPerMonth: { ar: 'د.ك / شهريًا', en: 'KWD / month' },
  billingDemoNote: {
    ar: 'وضع تجريبي: لم تُضبط مفاتيح Stripe، فتُفعَّل الترقية فورًا وتُسجَّل في سجل الفواتير. أضف STRIPE_SECRET_KEY وSTRIPE_PRICE_ID وSTRIPE_WEBHOOK_SECRET لتفعيل الدفع الحقيقي.',
    en: 'Demo mode: Stripe keys are not configured, so upgrades activate instantly and are recorded in the billing ledger. Add STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET to enable real payments.'
  },
  billingManageOnly: {
    ar: 'عرض للقراءة فقط: إدارة الباقة متاحة لصاحب مساحة العمل أو المدير.',
    en: 'Read-only view: plan management is available to the workspace OWNER or ADMIN.'
  },
  billingStale: { ar: 'هناك استجابة مخزّنة', en: 'Cached response' },
  billingFree: { ar: 'المجانية', en: 'Free' },
  billingPro: { ar: 'الاحترافية', en: 'Pro' },
  billingActive: { ar: 'نشط', en: 'active' },
  billingCanceled: { ar: 'ملغى', en: 'canceled' },
  billingPastDue: { ar: 'متأخر السداد', en: 'past due' },
  billingUpgraded: { ar: 'تمت الترقية إلى الاحترافية — سُجّلت في سجل الفواتير', en: 'Upgraded to Pro — recorded in the billing ledger' },
  billingCanceledToast: { ar: 'أُلغي الاشتراك وعادت المساحة للمجانية (البيانات محفوظة)', en: 'Subscription canceled — workspace back on Free (data retained)' },
  planLimitBanner: {
    ar: 'بلغتَ حد الباقة المجانية. تتيح الباقة الاحترافية سعة أعلى — جميع ميزات السلامة تبقى متاحة.',
    en: 'You reached the Free plan limit. The Pro plan offers higher capacity — all safety features remain available.'
  },
  planLimitBannerAction: { ar: 'عرض الباقات', en: 'View plans' },
  // Stage 6: notification center
  notifBell: { ar: 'مركز التنبيهات', en: 'Notification center' },
  notifTitle: { ar: 'التنبيهات', en: 'Notifications' },
  notifEmpty: {
    ar: 'لا توجد تنبيهات بعد — ستظهر هنا تذكيرات مواعيد رادار المواعيد وأحداث المراجعة وسلامة الأدلة.',
    en: 'No notifications yet — Deadline Radar reminders, review-queue events and evidence-integrity alerts will appear here.'
  },
  notifMarkAll: { ar: 'تعليم الكل كمقروء', en: 'Mark all read' },
  notifJustNow: { ar: 'الآن', en: 'just now' },
  notifMinAgo: { ar: 'د', en: 'm' },
  notifHourAgo: { ar: 'س', en: 'h' },
  notifDayAgo: { ar: 'يوم', en: 'd' },
  notifOpenCase: { ar: 'فتح ملف القضية', en: 'Open the case file' }
};
