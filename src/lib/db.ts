// Typed facade over the storage layer (Phase A, A1.1): every function is
// async and dialect-agnostic — the same signatures serve node:sqlite
// (STORAGE_BACKEND=sqlite, default) and Postgres 16 (STORAGE_BACKEND=pg)
// via src/lib/storage/ drivers. The full schema design is documented in
// prisma/schema.prisma; runtime DDL lives in sqlite.mjs (SQLite) and
// scripts/pg/*.sql (Postgres, RLS-enforced).

import {
  DB_PATH, nowIso, uuid, cuidish, sha256, hashPassword, verifyPassword,
  mapOrg, mapUser, mapProvision, mapCase, mapEvent, mapDocument,
  mapDeadline, mapDraft, mapAck, mapNotification
} from './sqlite.mjs';
import { getDriver, driverNow, withSystemCtx, withUserCtx } from './storage';
import {
  lkbBackend, convexGetAllActiveProvisions, convexGetActiveProvisionCount,
  convexGetProvisionsByLaw, convexGetAllProvisions, convexFindProvision,
  convexGetProvisionById, convexGetAuditStats, convexGetKbStatsByLaw,
  convexVerifyProvision, convexDeactivateProvision, convexReactivateProvision,
  convexAmendProvision
} from './convex';
import { decryptField } from './crypto';
import { PLANS, type PlanId, type LimitKey } from './billing';

export {
  DB_PATH, nowIso, uuid, cuidish, sha256, hashPassword, verifyPassword,
  mapOrg, mapUser, mapProvision, mapCase, mapEvent, mapDocument,
  mapDeadline, mapDraft, mapAck, mapNotification
};

// Storage helpers re-exported for route convenience (getDriver is the
// request-context-aware statement runner; withSystemCtx/withUserCtx are the
// Phase A execution scopes). Canonical source: '@/lib/storage'.
export { getDriver, driverNow, withSystemCtx, withUserCtx, backend } from './storage';

// Compatibility re-export: request-context-aware statement runner. New code
// should `const d = await getDriver()` instead.
export const db = {
  prepare: (sql: string) => driverNow().prepare(sql),
  exec: (sql: string) => driverNow().exec(sql)
};

export interface OrgRow {
  id: string; name: string; slug: string; type: string; plan: string;
  planStatus: string; planRenewsAt?: string;
  joinCode: string; reviewQueueEnabled: boolean; createdAt: string;
  deleteScheduledAt?: string | null; deletedAt?: string | null;
}
export interface UserRow {
  id: string; email: string; name: string; locale: string;
  deleteScheduledAt?: string; createdAt: string;
}
export interface DbCase extends Record<string, unknown> {
  id: string; orgId: string; ownerId: string; number: string; court: string;
  circuit?: string; caseType: string; subType: string; role: string;
  filedAt?: string; servedAt?: string; opponent?: string; opponentPleading?: string;
  subjectName?: string; intakeChannel: string; createdAt: string; updatedAt: string;
}

// ---------- audit (append-only; PRD 6.7) ----------
// Always system-scoped on pg: audit rows are written by bb_system (bypass) —
// bb_app keeps SELECT+INSERT grants only (no UPDATE/DELETE ⇒ append-only),
// and tenant inserts that run outside a tenant tx (login/register) can never
// violate P12's WITH CHECK. The org attribution comes from the caller.
export async function audit(action: string, detail = '', orgId: string | null = null, userId: string | null = null): Promise<void> {
  return withSystemCtx(async () => {
    const d = await getDriver();
    await d.prepare('INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)')
      .run(uuid(), orgId, userId, nowIso(), action, detail);
  });
}

// ---------- orgs / memberships / users ----------
export const getOrgsForUser = async (userId: string): Promise<OrgRow[]> => {
  const d = await getDriver();
  return withUserCtx(userId, async () => {
    const rows = await d.prepare(
      `SELECT o.* FROM organizations o JOIN memberships m ON m.org_id = o.id
       WHERE m.user_id = ? ORDER BY o.created_at`
    ).all(userId);
    return rows.map(r => mapOrg(r) as OrgRow);
  });
};

export const getMembershipRole = async (userId: string, orgId: string): Promise<string | null> => {
  const d = await getDriver();
  return withUserCtx(userId, async () => {
    const row = await d.prepare('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?').get(userId, orgId) as { role: string } | undefined;
    return row?.role ?? null;
  });
};

export const getUserById = async (id: string): Promise<UserRow | null> => {
  const d = await getDriver();
  const row = await d.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return (mapUser(row) as UserRow) ?? null;
};

/** System-scoped login lookup (users table is RLS user-scoped on pg). */
export const findUserByEmail = async (email: string): Promise<(UserRow & { passwordHash: string }) | null> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const row = await d.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, string> | undefined;
    if (!row) return null;
    return { ...(mapUser(row) as UserRow), passwordHash: row.password_hash };
  });

export const getOrgById = async (id: string): Promise<OrgRow | null> => {
  const d = await getDriver();
  const row = await d.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
  return (mapOrg(row) as OrgRow) ?? null;
};

/** System-scoped join-code lookup (organizations are RLS org-scoped on pg). */
export const getOrgByJoinCode = async (code: string): Promise<OrgRow | null> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const row = await d.prepare('SELECT * FROM organizations WHERE join_code = ?').get(code);
    return (mapOrg(row) as OrgRow) ?? null;
  });

export const countOrgMembers = async (orgId: string): Promise<number> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const row = await d.prepare('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?').get(orgId) as { n: number };
    return Number(row.n);
  });

export const insertMembership = async (userId: string, orgId: string, role: string): Promise<void> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    await d.prepare('INSERT INTO memberships (id, user_id, org_id, role) VALUES (?,?,?,?)')
      .run(cuidish(), userId, orgId, role);
  });

// ---------- cases ----------
export const listCasesForOrg = async (orgId: string): Promise<DbCase[]> => {
  const d = await getDriver();
  return ((await d.prepare('SELECT * FROM cases WHERE org_id = ? ORDER BY updated_at DESC').all(orgId)) as Record<string, string>[])
    .map(r => mapCase(r) as DbCase);
};

export const getCaseById = async (id: string): Promise<DbCase | null> => {
  const d = await getDriver();
  const row = await d.prepare('SELECT * FROM cases WHERE id = ?').get(id);
  return (mapCase(row) as DbCase) ?? null;
};

/** Tenant-scoped case fetch with transparent decrypt of encrypted-at-rest
 *  fields (A2.3: `opponent_pleading` is ciphertext under ENCRYPTION_ENABLED). */
export const getCaseForOrg = async (id: string, orgId: string): Promise<DbCase | null> => {
  const d = await getDriver();
  const row = await d.prepare('SELECT * FROM cases WHERE id = ? AND org_id = ?').get(id, orgId) as Record<string, string> | undefined;
  if (!row) return null;
  const c = mapCase(row) as DbCase;
  c.opponentPleading = await decryptField(orgId, 'cases', 'opponent_pleading', id, c.opponentPleading ?? '');
  return c;
};

/** Draft fetch with transparent payload decrypt (A2.3). */
export const getDraftForOrg = async (id: string, orgId: string): Promise<ReturnType<typeof mapDraft> | null> => {
  const d = await getDriver();
  const row = await d.prepare('SELECT * FROM pack_drafts WHERE id = ? AND org_id = ?').get(id, orgId) as Record<string, unknown> | undefined;
  if (!row) return null;
  row.payload = await decryptField(orgId, 'pack_drafts', 'payload', String(row.id), String(row.payload ?? ''));
  return mapDraft(row);
};

export const getDraftsForCaseOrg = async (caseId: string, orgId: string) => {
  const d = await getDriver();
  const rows = await d.prepare('SELECT * FROM pack_drafts WHERE case_id = ? AND org_id = ? ORDER BY created_at DESC').all(caseId, orgId) as Record<string, unknown>[];
  const out: any[] = [];
  for (const row of rows) {
    row.payload = await decryptField(orgId, 'pack_drafts', 'payload', String(row.id), String(row.payload ?? ''));
    out.push(mapDraft(row));
  }
  return out;
};

export const getEventsForCase = async (caseId: string) => {
  const d = await getDriver();
  return ((await d.prepare('SELECT * FROM case_events WHERE case_id = ? ORDER BY date').all(caseId)) as Record<string, unknown>[])
    .map(r => mapEvent(r));
};

export const getDocumentsForCase = async (caseId: string) => {
  const d = await getDriver();
  return ((await d.prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY created_at').all(caseId)) as Record<string, unknown>[])
    .map(r => mapDocument(r));
};

// ---------- Legal Knowledge Base (global corpus, C-A9) ----------
// Phase A convex-native: LKB reads/writes are served by the Convex deployment
// (vivid-hare-882) when LKB_BACKEND=convex (default); the original driver
// path remains for STORAGE_BACKEND hermetic runs (e2e) and Postgres parity.
export const getAllActiveProvisions = async () => {
  if (lkbBackend() === 'convex') return convexGetAllActiveProvisions();
  const d = await getDriver();
  return ((await d.prepare('SELECT * FROM legal_provisions WHERE is_active = 1').all()) as Record<string, unknown>[])
    .map(r => mapProvision(r));
};

export const getActiveProvisionCount = async (): Promise<number> => {
  if (lkbBackend() === 'convex') return convexGetActiveProvisionCount();
  const d = await getDriver();
  const row = await d.prepare('SELECT COUNT(*) AS n FROM legal_provisions WHERE is_active = 1').get() as { n: number };
  return Number(row.n);
};

export const getProvisionsByLaw = async (lawId?: string) => {
  if (lkbBackend() === 'convex') return convexGetProvisionsByLaw(lawId);
  const d = await getDriver();
  const rows = lawId
    ? await d.prepare('SELECT * FROM legal_provisions WHERE is_active = 1 AND law_id = ? ORDER BY law_id, article_no').all(lawId)
    : await d.prepare('SELECT * FROM legal_provisions WHERE is_active = 1 ORDER BY law_id, article_no').all();
  return (rows as Record<string, unknown>[]).map(r => mapProvision(r));
};

// Full history including superseded/deactivated rows (audit queue "archived" view).
export const getAllProvisions = async (lawId?: string) => {
  if (lkbBackend() === 'convex') return convexGetAllProvisions(lawId);
  const d = await getDriver();
  const rows = lawId
    ? await d.prepare('SELECT * FROM legal_provisions WHERE law_id = ? ORDER BY article_no, version').all(lawId)
    : await d.prepare('SELECT * FROM legal_provisions ORDER BY law_id, article_no, version').all();
  return (rows as Record<string, unknown>[]).map(r => mapProvision(r));
};

export const findProvision = async (lawId: string, article: string) => {
  if (lkbBackend() === 'convex') return convexFindProvision(lawId, article);
  const d = await getDriver();
  const rows = await d.prepare('SELECT * FROM legal_provisions WHERE is_active = 1 AND law_id = ? AND article_no = ?').all(lawId, article);
  return (rows as Record<string, unknown>[]).map(r => mapProvision(r));
};

// ---------- Phase 0 citation audit (lawyer verification workflow) ----------
export interface DbProvision extends Record<string, unknown> {
  id: string; lawId: string; lawNameAr: string; lawNameEn: string; articleNo: string;
  amendmentVersion: string; effectiveFrom?: string; effectiveTo?: string; gazetteRef?: string;
  titleAr: string; titleEn: string; textAr: string; textEn: string;
  summaryAr: string; summaryEn: string; topics: string[];
  verified: boolean; verificationNote?: string; verifiedBy?: string; verifiedAt?: string;
  version: number; supersedesId?: string; isActive: boolean; createdAt: string;
}

export const getProvisionById = async (id: string): Promise<DbProvision | null> => {
  if (lkbBackend() === 'convex') return (await convexGetProvisionById(id)) as DbProvision | null;
  const d = await getDriver();
  return (mapProvision(await d.prepare('SELECT * FROM legal_provisions WHERE id = ?').get(id)) as DbProvision) ?? null;
};

export interface AuditStats {
  total: number; verified: number; pending: number; superseded: number;
  byLaw: Record<string, { total: number; verified: number }>;
}

export const getAuditStats = async (): Promise<AuditStats> => {
  if (lkbBackend() === 'convex') return convexGetAuditStats();
  const d = await getDriver();
  const rows = await d.prepare(
    `SELECT law_id, is_active, verified, COUNT(*) AS n FROM legal_provisions GROUP BY law_id, is_active, verified`
  ).all() as { law_id: string; is_active: number; verified: number; n: number }[];
  const stats: AuditStats = { total: 0, verified: 0, pending: 0, superseded: 0, byLaw: {} };
  for (const r of rows) {
    if (!stats.byLaw[r.law_id]) stats.byLaw[r.law_id] = { total: 0, verified: 0 };
    if (Number(r.is_active)) {
      stats.total += Number(r.n);
      stats.byLaw[r.law_id].total += Number(r.n);
      if (Number(r.verified)) {
        stats.verified += Number(r.n);
        stats.byLaw[r.law_id].verified += Number(r.n);
      } else {
        stats.pending += Number(r.n);
      }
    } else {
      stats.superseded += Number(r.n);
    }
  }
  return stats;
};

/** kb/stats facade (was raw SQLite SQL in the route — Phase A C-A5 pattern). */
export const getKbStatsByLaw = async (): Promise<{ byLaw: Record<string, number>; total: number; verified: number }> => {
  if (lkbBackend() === 'convex') return convexGetKbStatsByLaw();
  const d = await getDriver();
  const rows = await d.prepare('SELECT law_id, COUNT(*) AS n FROM legal_provisions WHERE is_active = 1 GROUP BY law_id').all() as { law_id: string; n: number }[];
  const byLaw: Record<string, number> = {};
  for (const r of rows) byLaw[r.law_id] = Number(r.n);
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  const verifiedRow = await d.prepare('SELECT COUNT(*) AS n FROM legal_provisions WHERE is_active = 1 AND verified = 1').get() as { n: number };
  return { byLaw, total, verified: Number(verifiedRow.n) };
};

export interface VerifyInput {
  note: string; gazetteRef?: string; effectiveFrom?: string; effectiveTo?: string;
  verifiedBy: string; verifiedByName: string;
}

export const verifyProvision = async (id: string, input: VerifyInput): Promise<DbProvision | null> => {
  if (lkbBackend() === 'convex') return (await convexVerifyProvision(id, input)) as DbProvision | null;
  return withSystemCtx(async () => {
  const d = await getDriver();
  await d.prepare(
    `UPDATE legal_provisions SET verified = 1, verification_note = ?, gazette_ref = COALESCE(?, gazette_ref),
       effective_from = COALESCE(?, effective_from), effective_to = ?, verified_by = ?, verified_at = ?
     WHERE id = ?`
  ).run(
    input.note, input.gazetteRef ?? null, input.effectiveFrom ?? null,
    input.effectiveTo ?? null, `${input.verifiedBy}|${input.verifiedByName}`, nowIso(), id
  );
  return getProvisionById(id);
  });
};

export const deactivateProvision = async (id: string, note: string, actor: string): Promise<DbProvision | null> => {
  if (lkbBackend() === 'convex') return (await convexDeactivateProvision(id, note, actor)) as DbProvision | null;
  return withSystemCtx(async () => {
  const d = await getDriver();
  await d.prepare(
    `UPDATE legal_provisions SET is_active = 0, verified = 0, verified_by = ?, verified_at = ?, verification_note = ? WHERE id = ?`
  ).run(actor, nowIso(), note, id);
  return getProvisionById(id);
  });
};

export const reactivateProvision = async (id: string, actor: string): Promise<DbProvision | null> => {
  if (lkbBackend() === 'convex') return (await convexReactivateProvision(id, actor)) as DbProvision | null;
  return withSystemCtx(async () => {
  const d = await getDriver();
  await d.prepare(
    `UPDATE legal_provisions SET is_active = 1, verified_by = ?, verified_at = ?,
       verification_note = 'reactivated for further review by ' || ? WHERE id = ?`
  ).run(actor, nowIso(), actor, id);
  return getProvisionById(id);
  });
};

export interface AmendInput {
  titleAr?: string; titleEn?: string; textAr: string; textEn: string;
  note: string; gazetteRef?: string; effectiveFrom?: string;
  verifiedBy: string; verifiedByName: string;
}

// Amend = publish a new version (lawyer-reviewed) and retire the old row.
// Full history is retained: superseded rows are never overwritten (PRD 6.3a).
export const amendProvision = async (id: string, input: AmendInput): Promise<{ provision: DbProvision | null; previous: DbProvision | null }> => {
  if (lkbBackend() === 'convex') return convexAmendProvision(id, input) as Promise<{ provision: DbProvision | null; previous: DbProvision | null }>;
  return withSystemCtx(async () => {
  const d = await getDriver();
  const prev = await getProvisionById(id);
  if (!prev) return { provision: null, previous: null };
  const newVersion = prev.version + 1;
  const newId = uuid();
  await d.prepare(
    `INSERT INTO legal_provisions
       (id, law_id, law_name_ar, law_name_en, article_no, amendment_version, effective_from, effective_to, gazette_ref,
        title_ar, title_en, text_ar, text_en, summary_ar, summary_en, topics,
        verified, verification_note, verified_by, verified_at, version, supersedes_id, is_active, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`
  ).run(
    newId, prev.lawId, prev.lawNameAr, prev.lawNameEn, prev.articleNo,
    `amendment-v${newVersion}`, input.effectiveFrom ?? prev.effectiveFrom ?? null, null,
    input.gazetteRef ?? prev.gazetteRef ?? null,
    input.titleAr?.trim() || prev.titleAr, input.titleEn?.trim() || prev.titleEn,
    input.textAr, input.textEn,
    `مُعدّلة ومُوثّقة من محامٍ في المرحلة صفر / Amended & verified by a lawyer in Phase 0`,
    `Amended & verified by a lawyer in Phase 0`,
    JSON.stringify(prev.topics),
    1, input.note, `${input.verifiedBy}|${input.verifiedByName}`, nowIso(),
    newVersion, prev.id, nowIso()
  );
  await d.prepare(
    `UPDATE legal_provisions SET is_active = 0, effective_to = ?, verification_note = ? WHERE id = ?`
  ).run(nowIso(), `superseded by amendment v${newVersion} — retired by ${input.verifiedByName}`, id);
  return { provision: await getProvisionById(newId), previous: await getProvisionById(id) };
  });
};

// ---------- Stage 5: billing, plans & usage ----------
export interface OrgUsage {
  activeCases: number; members: number; docsPerCaseMax: number;
  monthlyAnalysisRuns: number; month: string;
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export const getOrgUsage = async (orgId: string): Promise<OrgUsage> => {
  const d = await getDriver();
  const activeCases = (await d.prepare('SELECT COUNT(*) AS n FROM cases WHERE org_id = ?').get(orgId) as { n: number }).n;
  const members = (await d.prepare('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?').get(orgId) as { n: number }).n;
  const docsPerCaseMax = (await d.prepare(
    `SELECT COALESCE(MAX(n), 0) AS n FROM (SELECT COUNT(*) AS n FROM documents d JOIN cases c ON c.id = d.case_id WHERE c.org_id = ? GROUP BY d.case_id)`
  ).get(orgId) as { n: number }).n;
  const monthlyAnalysisRuns = (await d.prepare(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE org_id = ? AND action = 'analysis.run' AND at >= ?`
  ).get(orgId, monthStart()) as { n: number }).n;
  return {
    activeCases: Number(activeCases), members: Number(members), docsPerCaseMax: Number(docsPerCaseMax),
    monthlyAnalysisRuns: Number(monthlyAnalysisRuns), month: monthStart().slice(0, 7)
  };
};

export interface BillingEventRow {
  id: string; at: string; kind: string; plan: string; detail?: string; ref?: string;
}

export const getBillingEvents = async (orgId: string, limit = 25): Promise<BillingEventRow[]> => {
  const d = await getDriver();
  // C-A5: newest-first ordering — rowid on SQLite, generated seq on Postgres.
  const order = d.dialect === 'pg' ? 'at DESC, seq DESC' : 'at DESC, rowid DESC';
  const rows = await d.prepare(`SELECT * FROM billing_events WHERE org_id = ? ORDER BY ${order} LIMIT ?`).all(orgId, limit) as Record<string, string>[];
  return rows.map(r => ({ id: r.id, at: r.at, kind: r.kind, plan: r.plan, detail: r.detail, ref: r.ref }));
};

/** Idempotent billing ledger insert: same Stripe event id (ref) is ignored. */
export const recordBillingEvent = async (orgId: string, kind: string, plan: string, detail: string, ref?: string): Promise<boolean> => {
  const d = await getDriver();
  if (ref) {
    const existing = await d.prepare('SELECT id FROM billing_events WHERE ref = ?').get(ref);
    if (existing) return false;
  }
  await d.prepare('INSERT INTO billing_events (id, org_id, at, kind, plan, detail, ref) VALUES (?,?,?,?,?,?,?)')
    .run(uuid(), orgId, nowIso(), kind, plan, detail, ref ?? null);
  return true;
};

export interface SetPlanInput {
  status?: 'active' | 'canceled' | 'past_due';
  renewsAt?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  kind: string;
  detail: string;
  actor?: string | null;
  ref?: string;
}

export const setOrgPlan = async (orgId: string, plan: PlanId, input: SetPlanInput): Promise<OrgRow | null> => {
  const d = await getDriver();
  const org = await d.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as Record<string, string> | undefined;
  if (!org) return null;
  await d.prepare(
    `UPDATE organizations SET plan = ?, plan_status = ?, plan_renews_at = ?,
       stripe_customer_id = COALESCE(?, stripe_customer_id),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       updated_at = ? WHERE id = ?`
  ).run(
    plan, input.status ?? 'active', input.renewsAt ?? null,
    input.stripeCustomerId ?? null, input.stripeSubscriptionId ?? null,
    nowIso(), orgId
  );
  await recordBillingEvent(orgId, input.kind, plan, input.detail, input.ref);
  await audit(`billing.${input.kind}`, `${org.slug}: ${org.plan} -> ${plan}${input.detail ? ` (${input.detail})` : ''}`, orgId, input.actor ?? null);
  return getOrgById(orgId);
};

export interface BillingSummary {
  plan: PlanId;
  planStatus: string;
  planRenewsAt?: string | null;
  priceKwd: number;
  limits: Record<LimitKey, number>;
  usage: OrgUsage;
  stripeConfigured: boolean;
  canManage: boolean;
  events: BillingEventRow[];
}

export const getBillingSummary = async (orgId: string, role: string): Promise<BillingSummary | null> => {
  const org = await getOrgById(orgId);
  if (!org) return null;
  const plan = (org.plan === 'PRO' ? 'PRO' : 'FREE') as PlanId;
  return {
    plan,
    planStatus: org.planStatus,
    planRenewsAt: org.planRenewsAt,
    priceKwd: PLANS[plan].priceKwd,
    limits: PLANS[plan].limits,
    usage: await getOrgUsage(orgId),
    stripeConfigured: false, // filled by the route (env-dependent, kept out of the facade)
    canManage: role === 'OWNER' || role === 'ADMIN',
    events: await getBillingEvents(orgId)
  };
};

// ---------- Phase A additions (A2 hardening, C-A7 / C-A8) ----------

/** System-scoped org lookup for the billing webhook (no session by design). */
export const getOrgByStripeSubscription = async (subId: string): Promise<OrgRow | null> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const row = await d.prepare('SELECT * FROM organizations WHERE stripe_subscription_id = ?').get(subId);
    return (mapOrg(row) as OrgRow) ?? null;
  });

/** C-A7: invalidate every session cookie issued before now (logout/revocation). */
export const revokeAllSessions = async (userId: string): Promise<void> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    await d.prepare('UPDATE users SET sessions_invalid_before = ? WHERE id = ?').run(new Date().toISOString(), userId);
  });

/** 7-day workflow scheduling (PRD 5.10 AC1); the reaper (A5) completes it. */
export const scheduleAccountDelete = async (userId: string): Promise<string> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const at = nowIso();
    await d.prepare('UPDATE users SET delete_scheduled_at = ? WHERE id = ?').run(at, userId);
    return at;
  });

/** Security row for session verification (C-A7 revocation check). */
export const getUserSecurity = async (userId: string): Promise<{ sessionsInvalidBefore?: string; deleteScheduledAt?: string } | null> =>
  withUserCtx(userId, async () => {
    const d = await getDriver();
    const row = await d.prepare('SELECT sessions_invalid_before, delete_scheduled_at FROM users WHERE id = ?').get(userId) as
      { sessions_invalid_before?: string; delete_scheduled_at?: string } | undefined;
    if (!row) return null;
    return { sessionsInvalidBefore: row.sessions_invalid_before, deleteScheduledAt: row.delete_scheduled_at };
  });

/** Registration transaction (moved from the register route — system scope). */
export const registerUserAndOrg = async (input: {
  email: string; passwordHash: string; name: string; orgName?: string;
}): Promise<{ uid: string; orgId: string }> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const uid = cuidish();
    await d.prepare('INSERT INTO users (id, email, password_hash, name, locale, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(uid, input.email, input.passwordHash, input.name, 'ar', nowIso(), nowIso());
    const orgId = cuidish();
    const slugBase = `u-${uid.slice(-8)}`;
    await d.prepare(`INSERT INTO organizations (id, name, slug, type, plan, join_code, review_queue_enabled, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(orgId, input.orgName || `${input.name} — مساحة شخصية`, slugBase, 'INDIVIDUAL', 'FREE',
        'JOIN-' + Math.random().toString(36).slice(2, 8).toUpperCase(), 0, nowIso(), nowIso());
    await d.prepare('INSERT INTO memberships (id, user_id, org_id, role) VALUES (?,?,?,?)')
      .run(cuidish(), uid, orgId, 'OWNER');
    return { uid, orgId };
  });

/** Org creation from the orgs route (system scope: cross-row insert). */
export const createOrg = async (input: {
  name: string; type: string; reviewQueueEnabled: boolean; ownerId: string;
}): Promise<OrgRow> =>
  withSystemCtx(async () => {
    const d = await getDriver();
    const id = cuidish();
    const slug = `${input.type.toLowerCase()}-${id.slice(-8)}`;
    const joinCode = 'JOIN-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await d.prepare(`INSERT INTO organizations (id, name, slug, type, plan, join_code, review_queue_enabled, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, input.name, slug, input.type, 'FREE', joinCode,
        input.type !== 'INDIVIDUAL' && input.reviewQueueEnabled ? 1 : 0, nowIso(), nowIso());
    await d.prepare('INSERT INTO memberships (id, user_id, org_id, role) VALUES (?,?,?,?)')
      .run(cuidish(), input.ownerId, id, 'OWNER');
    return (await getOrgById(id)) as OrgRow;
  });
