import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, planLimitReached, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, sha256, mapDocument, getOrgById, getDocumentsForCase, getDriver, audit } from '@/lib/db';
import { PLANS } from '@/lib/billing';
import { notifyDocumentIntegrity } from '@/lib/notifications';
import { flags } from '@/lib/config';
import { getOrCreateOrgDek } from '@/lib/crypto';
import { ensureBucket, putObject, virusScan } from '@/lib/storage/object-store';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/cases/:id/documents — Evidence Integrity list (PRD 5.9 AC1).
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');
  return json({ documents: await getDocumentsForCase(id) });

});

// POST /api/cases/:id/documents — seal a document: SHA-256 + UTC timestamp.
// Data minimisation (CITRA-aligned, PRD §7): by default only hash + metadata
// are stored, never the file content itself. With OBJECT_STORAGE_ENABLED=true
// the original bytes are ALSO sealed into S3/MinIO (A3.2): stream → virus
// scan → SSE-C with the org DEK → WORM object-lock COMPLIANCE — the seal
// contract is unchanged: same SHA-256 over the exact bytes, same version
// chain, same mismatch flag, same notification hooks.
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id, owner_id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId) as { id: string; owner_id: string } | undefined;
  if (!row) return notFound('case');

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: 'empty upload' }, 400);
  if (buf.length > flags.docMaxUploadMb() * 1024 * 1024) {
    return json({ error: `upload too large (max ${flags.docMaxUploadMb()} MB)` }, 413);
  }
  const name = decodeURIComponent(req.headers.get('x-file-name') || 'document');
  const notes = req.headers.get('x-notes') || '';
  const metaRisk = (req.headers.get('x-meta-risk') || 'LOW').toUpperCase();
  const idempotencyKey = req.headers.get('x-idempotency-key') || req.headers.get('Idempotency-Key') || null;

  // A3.2 upload idempotency: a retried upload cannot double-seal or double-store.
  if (idempotencyKey) {
    const existing = await d.prepare('SELECT * FROM documents WHERE idempotency_key = ?').get(idempotencyKey) as Record<string, string> | undefined;
    if (existing) {
      return json({ ok: true, document: mapDocument(existing), hashMismatch: false, duplicate: true }, 200);
    }
  }

  // A3.2 step 4: virus-scan hook (VIRUS_SCAN_PROVIDER=none dev → 'skipped').
  const scan = await virusScan(buf);
  if (scan === 'infected') {
    await audit('document.infected', `${name} rejected by scanner`, guard.ctx.orgId, guard.ctx.uid);
    return json({ error: 'upload rejected: antivirus scan flagged the file' }, 422);
  }

  const hash = sha256(buf);
  const hashedAt = nowIso();

  // Plan capacity limit (Stage 5): sealed documents per case.
  const org = await getOrgById(guard.ctx.orgId);
  const plan = org?.plan === 'PRO' ? 'PRO' : 'FREE';
  const docCount = (await d.prepare('SELECT COUNT(*) AS n FROM documents WHERE case_id = ?').get(id) as { n: number }).n;
  if (docCount >= PLANS[plan].limits.maxDocsPerCase) {
    return planLimitReached('maxDocsPerCase', plan, PLANS[plan].limits.maxDocsPerCase);
  }

  const prior = await d.prepare('SELECT id, hash, version FROM documents WHERE case_id = ? AND name = ? ORDER BY version DESC LIMIT 1')
    .get(id, name) as { id: string; hash: string; version: number } | undefined;
  const mismatch = prior ? prior.hash !== hash : false;
  const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(metaRisk) ? metaRisk : 'LOW';

  const docId = cuidish();

  // A3.2 steps 6-7: object storage (opt-in). Fail-closed: when the flag is on
  // but storage fails, nothing is sealed (502) — a sealed evidence row must
  // never exist without its WORM object.
  let storageFields: Record<string, string | null> = {
    storage_key: null, storage_version_id: null, storage_class: null,
    retention_until: null, virus_scan_status: scan
  };
  if (flags.objectStorageEnabled()) {
    const bucketCheck = await ensureBucket();
    if (!bucketCheck.ok) return json({ error: 'object storage unavailable', detail: bucketCheck.detail }, 502);
    const orgDek = (await getOrCreateOrgDek(guard.ctx.orgId)).dek;
    const objectKey = `${guard.ctx.orgId}/${id}/${docId}/v${prior ? prior.version + 1 : 1}-${hash}`;
    const retentionUntil = new Date(Date.now() + flags.docRetentionYears() * 365 * 86400000);
    const put = await putObject(objectKey, buf, { orgDek, retentionUntil, contentType: req.headers.get('content-type') || 'application/octet-stream' });
    if (!put.ok) return json({ error: 'object storage write failed', detail: put.error }, 502);
    storageFields = {
      storage_key: `s3://${flags.s3().bucket}/${objectKey}`,
      storage_version_id: put.versionId ?? null,
      storage_class: 'STANDARD',
      retention_until: retentionUntil.toISOString(),
      virus_scan_status: scan
    };
  }

  await d.prepare(`INSERT INTO documents (id, case_id, name, hash, size, mime, hashed_at, meta_risk, notes, version, previous_id, created_at,
              storage_key, storage_version_id, storage_class, retention_until, virus_scan_status, idempotency_key)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(docId, id, name, hash, buf.length, req.headers.get('content-type') || '', hashedAt,
      risk, notes, prior ? prior.version + 1 : 1, prior ? prior.id : null, nowIso(),
      storageFields.storage_key, storageFields.storage_version_id, storageFields.storage_class,
      storageFields.retention_until, storageFields.virus_scan_status, idempotencyKey);
  await d.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  await audit('document.seal', `${id} ${hash.slice(0, 12)}${mismatch ? ' MISMATCH' : ''}${storageFields.storage_key ? ' stored' : ''}`, guard.ctx.orgId, guard.ctx.uid);

  // Stage 6: evidence-integrity inbox alerts — hash mismatch against the
  // previous version, or a HIGH metadata-risk seal reaching the case owner.
  const sealed = await d.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as Record<string, string>;
  const caseRow = await d.prepare('SELECT owner_id, number FROM cases WHERE id = ?').get(id) as { owner_id: string; number: string };
  await notifyDocumentIntegrity(
    { id: docId, name: String(sealed.name), metaRisk: risk },
    { id, orgId: guard.ctx.orgId, ownerId: String(caseRow.owner_id), number: String(caseRow.number ?? '') },
    mismatch, guard.ctx.uid
  );

  return json({ ok: true, document: mapDocument(sealed), hashMismatch: mismatch }, 201);

});
