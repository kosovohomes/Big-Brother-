import { NextRequest } from 'next/server';
import {json, requireOrg, readJson, canManageCases, planLimitReached, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, listCasesForOrg, getOrgById, audit } from '@/lib/db';
import { getDriver } from '@/lib/storage';
import { encryptField } from '@/lib/crypto';
import { PLANS } from '@/lib/billing';

// GET /api/cases — tenant-scoped case list (all data isolation by orgId).
export const GET = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const cases = await listCasesForOrg(guard.ctx.orgId);
  // include event/doc counts for dashboard chips
  const counts = await d.prepare(`
    SELECT c.id,
      (SELECT COUNT(*) FROM case_events e WHERE e.case_id = c.id) AS events,
      (SELECT COUNT(*) FROM documents d WHERE d.case_id = c.id) AS documents
    FROM cases c WHERE c.org_id = ?`).all(guard.ctx.orgId) as { id: string; events: number; documents: number }[];
  const byId = new Map(counts.map(r => [r.id, r]));
  return json({
    cases: cases.map(c => ({
      ...c,
      eventCount: byId.get(c.id)?.events || 0,
      documentCount: byId.get(c.id)?.documents || 0
    }))
  });

});

// POST /api/cases — create a case. Two first-class intake channels:
//  - self (manual entry — the primary, always-available path, PRD Change 9)
//  - ngo_assisted (caseworker creates on behalf of a client with recorded
//    consent — PRD 5.1 AC4/Change 13) — consentText is mandatory and stored.
export const POST = withOrg(async function(req: NextRequest) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const role = guard.role;
  if (!canManageCases(role)) return json({ error: 'role cannot create cases' }, 403);

  const body = await readJson<{
    number?: string; court?: string; circuit?: string; caseType?: string; subType?: string;
    role?: string; filedAt?: string; servedAt?: string; opponent?: string;
    opponentPleading?: string; subjectName?: string; intakeChannel?: string; consentText?: string;
  }>(req);

  const intake = body.intakeChannel === 'ngo_assisted' ? 'ngo_assisted' : 'self';
  if (intake === 'ngo_assisted') {
    if (!['OWNER', 'ADMIN', 'CASEWORKER'].includes(role)) {
      return json({ error: 'only caseworkers/admins can perform NGO-assisted intake' }, 403);
    }
    if (!body.consentText || !body.subjectName) {
      return json({ error: 'NGO-assisted intake requires subjectName and recorded consentText (PRD 5.1 AC4)' }, 400);
    }
  }

  // Plan capacity limit (Stage 5): active cases per workspace. Safety
  // features are never gated — this is a capacity limit only.
  const org = await getOrgById(guard.ctx.orgId);
  const plan = org?.plan === 'PRO' ? 'PRO' : 'FREE';
  const activeCases = (await d.prepare('SELECT COUNT(*) AS n FROM cases WHERE org_id = ?').get(guard.ctx.orgId) as { n: number }).n;
  if (activeCases >= PLANS[plan].limits.maxActiveCases) {
    return planLimitReached('maxActiveCases', plan, PLANS[plan].limits.maxActiveCases);
  }

  const id = cuidish();
  const caseType = ['civil', 'criminal', 'family'].includes(String(body.caseType)) ? String(body.caseType) : 'civil';
  // A2.3: opponent pleading is encrypted at rest (transparent decrypt on read).
  const pleadingCipher = await encryptField(guard.ctx.orgId, 'cases', 'opponent_pleading', id, body.opponentPleading || '');
  await d.prepare(`INSERT INTO cases
    (id, org_id, owner_id, number, court, circuit, case_type, sub_type, role, filed_at, served_at, opponent, opponent_pleading, subject_name, intake_channel, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, guard.ctx.orgId, guard.ctx.uid, body.number || '', body.court || '', body.circuit || '',
      caseType, body.subType || 'execution', body.role === 'plaintiff' ? 'plaintiff' : 'defendant',
      body.filedAt || null, body.servedAt || null, body.opponent || '', pleadingCipher,
      intake === 'ngo_assisted' ? String(body.subjectName) : null, intake, nowIso(), nowIso());

  // Consent record (PRD 5.1 AC3): stored for BOTH intake channels.
  const consentText = body.consentText ||
    'أوافق على تخزين بيانات قضيتي (الوقائع، التواريخ، المستندات وبصماتها) لغرض تحليلها إجرائيًا وتقديم معلومات تعليمية، مع حق حذفها في أي وقت خلال 7 أيام كحد أقصى. / I consent to storing my case data for procedural analysis and educational information, with deletion within 7 days on request.';
  await d.prepare('INSERT INTO consents (id, user_id, case_id, scope, version, text_snapshot, accepted_at) VALUES (?,?,?,?,?,?,?)')
    .run(cuidish(), guard.ctx.uid, id, intake, 'v2.1', consentText, nowIso());
  await audit('case.create', `${id} (${caseType}/${intake})`, guard.ctx.orgId, guard.ctx.uid);
  return json({ ok: true, id }, 201);

});
