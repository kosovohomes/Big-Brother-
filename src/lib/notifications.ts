// Stage 6: notification center engine — per-user inboxes with idempotent,
// escalating deadline reminders plus event-driven workspace notifications.
//
// Design notes:
// - Reminders are materialized on read (syncDeadlineReminders) instead of a
//   cron: nothing runs when nobody looks, and the unique (user_id, dedupe_key)
//   index makes repeated syncs a no-op.
// - Each deadline escalates through urgency buckets (soon → critical →
//   overdue); crossing into a more urgent band creates a NEW reminder, so the
//   user sees the escalation rather than one stale message.
// - Nothing is org-wide: every row is addressed to exactly one user, so a new
//   member never sees history they were not part of.
//
// Phase A (A2.2 #3): reviewer fan-out inserts rows for users OTHER than the
// actor — under Postgres RLS (P10 WITH CHECK org+recipient) that insert is
// impossible for bb_app, so cross-recipient fan-out runs in the system scope
// (the app_notify pattern from the spec, kept at library level so every
// caller keeps its signature). All functions are async now (driver contract).

import { withSystemCtx } from './db';
import { getDriver } from './storage';
import { nowIso, uuid, mapNotification } from './sqlite.mjs';
import { deriveDeadlines } from './engine';
import type { CaseData } from './types';

export interface NotificationRow {
  id: string; orgId: string; userId: string; type: string; dedupeKey: string;
  titleAr: string; titleEn: string; bodyAr?: string; bodyEn?: string;
  caseId?: string; refType?: string; refId?: string; urgency?: string;
  readAt?: string; createdAt: string;
}

export interface NotificationInput {
  type: string; dedupeKey: string;
  titleAr: string; titleEn: string; bodyAr?: string; bodyEn?: string;
  caseId?: string; refType?: string; refId?: string; urgency?: string;
}

/** Idempotent single-recipient insert. Returns the row, or null on duplicate.
 *  Cross-recipient inserts run system-scoped (P10 WITH CHECK on pg). */
export async function notifyUser(userId: string, orgId: string, n: NotificationInput): Promise<NotificationRow | null> {
  return withSystemCtx(async () => {
    const d = await getDriver();
    const dup = await d.prepare('SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?').get(userId, n.dedupeKey);
    if (dup) return null;
    const id = uuid();
    await d.prepare(
      `INSERT INTO notifications
         (id, org_id, user_id, type, dedupe_key, title_ar, title_en, body_ar, body_en,
          case_id, ref_type, ref_id, urgency, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, orgId, userId, n.type, n.dedupeKey, n.titleAr, n.titleEn,
      n.bodyAr ?? null, n.bodyEn ?? null, n.caseId ?? null,
      n.refType ?? null, n.refId ?? null, n.urgency ?? null, nowIso()
    );
    return mapNotification(await d.prepare('SELECT * FROM notifications WHERE id = ?').get(id)) as NotificationRow;
  });
}

// ---------- deadline reminders (derived, escalating) ----------

const bucketOf = (daysLeft: number): 'overdue' | 'critical' | 'soon' | null =>
  daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'critical' : daysLeft <= 30 ? 'soon' : null;

const BUCKET_AR: Record<string, string> = {
  overdue: 'تجاوز الموعد',
  critical: 'أيام حرجة (≤ 7 أيام)',
  soon: 'قريب (≤ 30 يومًا)'
};
const BUCKET_EN: Record<string, string> = {
  overdue: 'Overdue',
  critical: 'Critical (≤ 7 days)',
  soon: 'Soon (≤ 30 days)'
};

/**
 * Materialize deadline reminders for every case in the org. Returns the number
 * of NEW notifications created (0 when everything is already synced).
 */
export async function syncDeadlineReminders(userId: string, orgId: string): Promise<number> {
  let created = 0;
  for (const c of await getOrgsCases(orgId)) {
    const data = { ...c, events: await getCaseEvents(c.id), documents: [] } as unknown as CaseData;
    for (const d of deriveDeadlines(data)) {
      const daysLeft = Math.floor((new Date(d.dueAt).getTime() - Date.now()) / 86400000);
      const bucket = bucketOf(daysLeft);
      if (!bucket) continue;
      const caseLabel = c.number ? ` «${c.number}»` : '';
      const bodyAr = `${BUCKET_AR[bucket]} — متبقٍ ${daysLeft < 0 ? `${Math.abs(daysLeft)} يومًا بعد الموعد` : `${daysLeft} يومًا`} للقضية${caseLabel}. تحقق من التاريخ الفعلي في ملف القضية ومن صلاحية التمديد مع محامٍ مؤهل.`;
      const bodyEn = `${BUCKET_EN[bucket]} — ${daysLeft < 0 ? `${Math.abs(daysLeft)} day(s) past due` : `${daysLeft} day(s) left`} for case ${c.number ? `«${c.number}»` : ''}. Verify the actual date in the case file and any extension validity with a qualified lawyer.`;
      const row = await notifyUser(userId, orgId, {
        type: 'deadline.reminder',
        dedupeKey: `deadline:${d.id}:${bucket}`,
        titleAr: d.titleAr,
        titleEn: d.titleEn,
        bodyAr, bodyEn,
        caseId: c.id,
        refType: 'deadline',
        refId: d.id,
        urgency: bucket
      });
      if (row) created++;
    }
  }
  return created;
}

// Local imports kept lazy to avoid a circular import with db.ts at module load.
async function getOrgsCases(orgId: string) {
  const { listCasesForOrg } = await import('./db');
  return listCasesForOrg(orgId);
}
async function getCaseEvents(caseId: string) {
  const { getEventsForCase } = await import('./db');
  return getEventsForCase(caseId);
}

// ---------- event-driven workspace notifications ----------

const REVIEWER_ROLES = ['OWNER', 'ADMIN', 'LAWYER'];

/** finalize → IN_REVIEW: tell every reviewer (except the submitting actor). */
export async function notifyReviewersOfDraft(draft: {
  id: string; orgId: string; caseId: string; type: string;
  titleAr: string; titleEn: string;
}, actorId: string): Promise<number> {
  const d = await getDriver();
  // Members of the active org are RLS-visible (P2); the fan-out inserts are
  // cross-recipient and therefore system-scoped inside notifyUser.
  const members = await d.prepare('SELECT user_id, role FROM memberships WHERE org_id = ?').all(draft.orgId) as
    { user_id: string; role: string }[];
  let n = 0;
  for (const m of members) {
    if (m.user_id === actorId || !REVIEWER_ROLES.includes(m.role)) continue;
    const r = await notifyUser(m.user_id, draft.orgId, {
      type: 'draft.review_requested',
      dedupeKey: `draft:review:${draft.id}`,
      titleAr: `مسودة بانتظار المراجعة: ${draft.titleAr}`,
      titleEn: `Draft awaiting review: ${draft.titleEn}`,
      bodyAr: `نوع المسودة: ${draft.type}. طابور المراجعة البشرية في مساحة العمل لديه عنصر جديد — التصريح متاح لأدوار OWNER/ADMIN/LAWYER فقط.`,
      bodyEn: `Draft type: ${draft.type}. The workspace human-review queue has a new item — release is restricted to OWNER/ADMIN/LAWYER roles.`,
      caseId: draft.caseId,
      refType: 'draft', refId: draft.id,
      urgency: 'medium'
    });
    if (r) n++;
  }
  return n;
}

/** release → RELEASED: tell the draft's creator when a reviewer lets it go. */
export async function notifyDraftReleased(draft: {
  id: string; orgId: string; caseId: string; type: string;
  titleAr: string; titleEn: string; createdById: string;
}, actorId: string): Promise<NotificationRow | null> {
  if (draft.createdById === actorId) return null; // released by the creator — nothing to report
  return notifyUser(draft.createdById, draft.orgId, {
    type: 'draft.released',
    dedupeKey: `draft:released:${draft.id}`,
    titleAr: `تمت المصادقة على مسودتك: ${draft.titleAr}`,
    titleEn: `Your draft was released: ${draft.titleEn}`,
    bodyAr: `راجع إحدى الأدوار المصرّح بها المسودة (${draft.type}) وأقرّها من طابور المراجعة البشرية. تصدير المسودة يظل يتطلب باب الإقرار غير القابل للإخفاء.`,
    bodyEn: `An authorized role reviewed and released your draft (${draft.type}) from the human review queue. Exporting still requires the non-dismissible acknowledgment gate.`,
    caseId: draft.caseId,
    refType: 'draft', refId: draft.id,
    urgency: 'low'
  });
}

/**
 * Evidence integrity: when a sealed document has a hash MISMATCH against the
 * previous version, or metadata risk is HIGH, tell the case owner (unless the
 * owner is the one sealing and saw the result inline).
 */
export async function notifyDocumentIntegrity(doc: {
  id: string; name: string; metaRisk: string;
}, caseRow: { id: string; orgId: string; ownerId: string; number: string },
  mismatch: boolean, actorId: string): Promise<NotificationRow | null> {
  if (!mismatch && doc.metaRisk !== 'HIGH') return null;
  if (!mismatch && doc.metaRisk === 'HIGH' && caseRow.ownerId === actorId) return null;
  if (mismatch && caseRow.ownerId === actorId) return null; // owner sees the flag in the seal response
  const caseLabel = caseRow.number ? ` «${caseRow.number}»` : '';
  return notifyUser(caseRow.ownerId, caseRow.orgId, {
    type: mismatch ? 'document.mismatch' : 'document.risk_high',
    dedupeKey: `doc:${doc.id}:${mismatch ? 'mismatch' : 'risk'}`,
    titleAr: mismatch
      ? `تعارض بصمة مستند: ${doc.name}`
      : `مستند بمخاطر بيانات وصفية مرتفعة: ${doc.name}`,
    titleEn: mismatch
      ? `Document hash mismatch: ${doc.name}`
      : `Document with HIGH metadata risk: ${doc.name}`,
    bodyAr: mismatch
      ? `اختلفت بصمة SHA-256 عن الإصدار السابق لنفس الاسم في القضية${caseLabel}. الأنساق محفوظة في سلسلة الإصدارات — راجع أي نسخة هي النسخة الأصلية مع محامٍ.`
      : `خُتم مستند بمخاطر بيانات وصفية مرتفعة (META HIGH) في القضية${caseLabel}. راجع أصل المستند قبل أي اعتماد عليه في ملفات المرافعة.`,
    bodyEn: mismatch
      ? `The SHA-256 hash differs from the previous version of the same file name in case${caseLabel}. Versions are preserved in the integrity chain — verify which version is the original with a lawyer.`
      : `A document with HIGH metadata risk was sealed in case${caseLabel}. Review the original before relying on it in any pleading.`,
    caseId: caseRow.id,
    refType: 'document', refId: doc.id,
    urgency: 'high'
  });
}

// ---------- inbox queries ----------

export async function listNotifications(userId: string, orgId: string, limit = 100): Promise<NotificationRow[]> {
  const d = await getDriver();
  // C-A5: newest-first ordering — rowid on SQLite, generated seq on Postgres.
  const order = d.dialect === 'pg' ? 'created_at DESC, seq DESC' : 'created_at DESC, rowid DESC';
  const rows = await d.prepare(
    `SELECT * FROM notifications WHERE user_id = ? AND org_id = ? ORDER BY ${order} LIMIT ?`
  ).all(userId, orgId, limit) as Record<string, string>[];
  return rows.map(r => mapNotification(r) as NotificationRow);
}

export async function unreadCount(userId: string, orgId: string): Promise<number> {
  const d = await getDriver();
  const row = await d.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND org_id = ? AND read_at IS NULL'
  ).get(userId, orgId) as { n: number };
  return Number(row.n);
}

export async function markRead(userId: string, orgId: string, id?: string): Promise<number> {
  const d = await getDriver();
  if (id) {
    // Scoped to the recipient: you can only mark your own rows.
    const r = await d.prepare(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND org_id = ? AND read_at IS NULL'
    ).run(nowIso(), id, userId, orgId);
    return Number(r.changes);
  }
  const r = await d.prepare(
    'UPDATE notifications SET read_at = ? WHERE user_id = ? AND org_id = ? AND read_at IS NULL'
  ).run(nowIso(), userId, orgId);
  return Number(r.changes);
}
