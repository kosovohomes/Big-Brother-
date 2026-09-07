// Seed script — run: node scripts/seed.mjs
// Idempotent. Seeds the Legal Knowledge Base (34 imported corpus entries +
// family-law provisions), demo tenants, users, and two demo cases.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db, uuid, cuidish, nowIso, hashPassword, audit
} from '../src/lib/sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(__dirname, '../src/lib/seed-data/corpus.json'), 'utf8'));
const family = JSON.parse(readFileSync(join(__dirname, '../src/lib/seed-data/family.json'), 'utf8'));

const PROVISION_COUNT = () =>
  db.prepare('SELECT COUNT(*) AS n FROM legal_provisions').get().n;

function seedProvisions() {
  if (PROVISION_COUNT() > 0) return false;
  const ins = db.prepare(`INSERT INTO legal_provisions
    (id, law_id, law_name_ar, law_name_en, article_no, amendment_version, effective_from, effective_to, gazette_ref,
     title_ar, title_en, text_ar, text_en, summary_ar, summary_en, topics, verified, verification_note, version, supersedes_id, is_active, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  db.exec('BEGIN');
  for (const e of corpus) {
    const note = 'مُستورد من الإصدار 0.1 — بانتظار التدقيق المرجعي في المرحلة صفر / Imported from v0.1 corpus — pending Phase 0 citation audit';
    ins.run(
      uuid(), e.law, e.lawAr, 'Kuwait statute (imported corpus)', e.article, 'original', null, null, null,
      e.titleAr, e.titleAr, e.textAr, e.textEn, e.textAr.slice(0, 120), e.textEn.slice(0, 120),
      JSON.stringify(e.topics), 0, note, 1, null, 1, nowIso()
    );
  }
  for (const p of family) {
    ins.run(
      uuid(), p.lawId, p.lawNameAr, p.lawNameEn, p.articleNo, 'original', null, null, null,
      p.titleAr, p.titleEn, p.textAr, p.textEn, p.summaryAr, p.summaryEn,
      JSON.stringify(p.topics), 0, p.verificationNote, 1, null, 1, nowIso()
    );
  }
  db.exec('COMMIT');
  audit('lkb.seed', `${corpus.length} corpus + ${family.length} family provisions (all unverified pending Phase 0)`);
  return true;
}

function upsertUser(email, name, password = 'demo1234') {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const id = cuidish();
  db.prepare('INSERT INTO users (id, email, password_hash, name, locale, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, email, hashPassword(password), name, 'ar', nowIso(), nowIso());
  return id;
}

function upsertOrg(name, slug, type, reviewQueue = false) {
  const existing = db.prepare('SELECT id, join_code FROM organizations WHERE slug = ?').get(slug);
  if (existing) return { id: existing.id, joinCode: existing.join_code };
  const id = cuidish();
  const joinCode = slug.toUpperCase().slice(0, 4).replace(/[^A-Z0-9]/g, 'X').padEnd(4, 'X') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  db.prepare(`INSERT INTO organizations (id, name, slug, type, plan, join_code, review_queue_enabled, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, name, slug, type, 'FREE', joinCode, reviewQueue ? 1 : 0, nowIso(), nowIso());
  return { id, joinCode };
}

function addMembership(userId, orgId, role) {
  const existing = db.prepare('SELECT id FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId);
  if (existing) return;
  db.prepare('INSERT INTO memberships (id, user_id, org_id, role) VALUES (?,?,?,?)').run(cuidish(), userId, orgId, role);
}

function seedDemo() {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const flag = db.prepare("SELECT key FROM meta WHERE key = 'demo_seeded'").get();
  if (flag) return false;

  const ahmedOrg = upsertOrg('أحمد — مساحة شخصية', 'ahmed-personal', 'INDIVIDUAL');
  const ngoOrg = upsertOrg('جمعية سند للمساعدة القانونية', 'sanad-ngo', 'NGO', true);
  const firmOrg = upsertOrg('مكتب العدل للمحاماة', 'adl-law-firm', 'LAW_FIRM');
  const fatimaOrg = upsertOrg('فاطمة — مساحة شخصية', 'fatima-personal', 'INDIVIDUAL');

  const ahmed = upsertUser('ahmed@demo.kw', 'أحمد المطيري');
  const fatima = upsertUser('fatima@demo.kw', 'فاطمة العنزي');
  const caseworker = upsertUser('ngo@demo.kw', 'منال — عاملة اجتماعية');
  const lawyer = upsertUser('lawyer@demo.kw', 'المحامي عبدالله');
  const admin = upsertUser('admin@demo.kw', 'مدير النظام');

  addMembership(ahmed, ahmedOrg.id, 'OWNER');
  addMembership(fatima, fatimaOrg.id, 'OWNER');
  addMembership(fatima, ngoOrg.id, 'MEMBER');
  addMembership(caseworker, ngoOrg.id, 'CASEWORKER');
  addMembership(lawyer, ngoOrg.id, 'LAWYER');
  addMembership(lawyer, firmOrg.id, 'OWNER');
  addMembership(admin, ngoOrg.id, 'ADMIN');

  const consentText = 'أوافق على تخزين بيانات قضيتي (الوقائع، التواريخ، المستندات وبصماتها) لغرض تحليلها إجرائيًا وتقديم معلومات تعليمية، مع حق حذفها في أي وقت خلال 7 أيام كحد أقصى، وعدم مشاركتها دون إذن. / I consent to storing my case data (facts, dates, documents and hashes) for procedural analysis and educational information, with deletion within 7 days on request and no sharing without permission.';

  const insCase = db.prepare(`INSERT INTO cases
    (id, org_id, owner_id, number, court, circuit, case_type, sub_type, role, filed_at, served_at, opponent, opponent_pleading, subject_name, intake_channel, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insEvent = db.prepare('INSERT INTO case_events (id, case_id, date, title, type, note, appeal_filed, defect, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const insDoc = db.prepare('INSERT INTO documents (id, case_id, name, hash, size, mime, hashed_at, meta_risk, notes, version, previous_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const insConsent = db.prepare('INSERT INTO consents (id, user_id, case_id, scope, version, text_snapshot, accepted_at) VALUES (?,?,?,?,?,?,?)');

  const dayIso = d => d.toISOString().slice(0, 10);
  const daysAgo = n => new Date(Date.now() - n * 86400000);

  // ---- Case 1: civil execution (Ahmed, individual tenant) ----
  const c1 = cuidish();
  insCase.run(c1, ahmedOrg.id, ahmed, '2024/1187 تنفيذي', 'محكمة الاستئناف — قسم التنفيذ', 'الدائرة الثالثة',
    'civil', 'execution', 'defendant', dayIso(daysAgo(400)), dayIso(daysAgo(370)), 'شركة الإنشاءات الوطنية',
    'يدّعي المدعي تنفيذا على أساس محضر ضبط ولا يوجد توقيع لنا عليه.\nيستند إلى مستند كشف حضور يظهر أننا كنا في مقر العمل يوم 12 مارس بينما الإيصالات تثبت غير ذلك.\nيطلب الحكم علينا بالمبلغ كاملا مع الاشتراطات والتقرير.\nأبرز المستند عبارة عن كشف حضور مطبوع لا يحمل ختما واضحا.',
    null, 'self', nowIso(), nowIso());
  insConsent.run(cuidish(), ahmed, c1, 'case_data', 'v2.1', consentText, nowIso());
  const ev1 = [
    ['قيد الدعوى (أصل الدعوى 2023/776)', 'filing', 400],
    ['تبليغ صحيفة الدعوى', 'service', 370],
    ['إشكال تبليغ: خطأ في رقم الطابق', 'service-issue', 369],
    ['جلسة أولى', 'session', 330],
    ['تأجيل لعدم اكتمال التبليغات', 'adjournment', 300],
    ['تأجيل ثانٍ لطلب المدعي', 'adjournment', 260],
    ['تأجيل ثالث', 'adjournment', 220],
    ['تقديم كشف حضور في اللحظة الأخيرة', 'late-submission', 200],
    ['تقديم إيصالات سداد في اللحظة الأخيرة', 'late-submission', 195],
    ['تاريخ استحقاق الدين المزعوم', 'debt-due', 720],
    ['صدور الحكم الابتدائي', 'judgment', 60]
  ];
  for (const [title, type, ago] of ev1) {
    insEvent.run(uuid(), c1, dayIso(daysAgo(ago)), title, type,
      type === 'late-submission' ? 'قُدّم دون إشعار مسبق' : '', 0, 0, nowIso());
  }
  insDoc.run(uuid(), c1, 'كشف_الحضور_المزعوم.pdf', 'a3f1c0de9b8d7e6f5a4b3c2d1e0f9876543210abcdef1234567890abcdef1234',
    48213, 'application/pdf', daysAgo(200).toISOString(), 'HIGH',
    'لا يحمل ختما واضحا وتعارض التواريخ مع الإيصالات', 1, null, nowIso());
  insDoc.run(uuid(), c1, 'عقد_العمل.pdf', 'bb71aa22cc33dd44ee55ff660011223344556677889900aabbccddeeff00112',
    122880, 'application/pdf', daysAgo(395).toISOString(), 'LOW', '', 1, null, nowIso());

  // ---- Case 2: family maintenance/custody (NGO-assisted intake) ----
  const c2 = cuidish();
  insCase.run(c2, ngoOrg.id, caseworker, '2025/931 أسري', 'محكمة الأسرة', 'الدائرة الأولى',
    'family', 'family', 'plaintiff', dayIso(daysAgo(150)), dayIso(daysAgo(140)), 'الزوج — خالد الصباح',
    'يدّعي الزوج أن النفقة المدفوعة سلفا تغطي كل ما هو مطلوب.\nيستند إلى تحويل بنكي شهري دون تحديد وجهها.\nيطلب رفض المطالبة وتحميلي المصاريف.\nالمستند المرفق صورة تحويل لا يحمل وصفا.',
    'فاطمة العنزي', 'ngo_assisted', nowIso(), nowIso());
  insConsent.run(cuidish(), caseworker, c2, 'ngo_assisted', 'v2.1',
    consentText + ' — قُيّدت الموافقة بحضور عاملة الحالة (تسجيل صوتي محفوظ بالبصمة).', nowIso());
  const ev2 = [
    ['قيد دعوى النفقة', 'filing', 150],
    ['تبليغ الزوج', 'service', 140],
    ['نفقة غير مدفوعة عن ثلاثة أشهر', 'maintenance-unpaid', 100],
    ['جلسة صلح أولى', 'session', 90],
    ['إشكال مشاهدة: منع دون مسوغ', 'custody-issue', 80],
    ['حكم أول درجة بالنفقة', 'judgment', 45]
  ];
  for (const [title, type, ago] of ev2) {
    insEvent.run(uuid(), c2, dayIso(daysAgo(ago)), title, type, '', 0, 0, nowIso());
  }
  insDoc.run(uuid(), c2, 'تحويل_بنكي_بدون_وصف.pdf', 'cc72bb33dd44ee55ff66770011223344556677889900aabbccddeeff0011233',
    20480, 'application/pdf', daysAgo(95).toISOString(), 'MEDIUM',
    'لا يحمل وصف الغرض — قد يتعارض مع محاضر الصلح', 1, null, nowIso());

  db.prepare('INSERT INTO meta (key, value) VALUES (?,?)').run('demo_seeded', nowIso());
  audit('demo.seed', 'orgs: ahmed/sanad-ngo/adl; users: 5; cases: 2');
  return true;
}

const p = seedProvisions();
const d = seedDemo();
console.log(`[seed] provisions: ${p ? 'seeded' : 'already present'} (total ${PROVISION_COUNT()}); demo data: ${d ? 'seeded' : 'already present'}`);
