import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, notFound , withOrg } from '@/lib/api-helpers';
import { getDriver, audit } from '@/lib/db';
import { getOrCreateOrgDek } from '@/lib/crypto';
import { getObject } from '@/lib/storage/object-store';

type Ctx = { params: Promise<{ id: string; docId: string }> };

// GET /api/cases/:id/documents/:docId/download — original bytes (A3.4).
// Auth-scoped like every case child; audited (`document.download`); 404 for
// foreign orgs (T-22). With object storage on, the bytes are fetched with the
// org's DEK-derived SSE-C key and proxied (presigned URLs would leak the
// customer key — see object-store.ts). Hash-only mode → 409 (nothing stored).
export const GET = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id, docId } = await ctx.params;
  const doc = await d.prepare(
    `SELECT doc.* FROM documents doc JOIN cases c ON c.id = doc.case_id
     WHERE doc.id = ? AND doc.case_id = ? AND c.org_id = ?`
  ).get(docId, id, guard.ctx.orgId) as Record<string, string | null> | undefined;
  if (!doc) return notFound('document');
  if (doc.deleted_at) return json({ error: 'document original deleted (metadata skeleton retained for the evidence chain)' }, 410);
  if (!doc.storage_key) {
    return json({ error: 'original not stored (hash-only seal mode)', detail: 'OBJECT_STORAGE_ENABLED=false — only the SHA-256 + metadata exist server-side.' }, 409);
  }
  const objectKey = String(doc.storage_key).replace(/^s3:\/\/[^/]+\//, '');
  const orgDek = (await getOrCreateOrgDek(guard.ctx.orgId)).dek;
  const obj = await getObject(objectKey, orgDek);
  if (!obj.ok) return json({ error: 'object fetch failed', status: obj.status }, 502);
  await audit('document.download', `${id}/${docId}`, guard.ctx.orgId, guard.ctx.uid);
  return new NextResponse(new Uint8Array(obj.body), {
    status: 200,
    headers: {
      'Content-Type': String(doc.mime || 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(String(doc.name)).replace(/["\\]/g, '_')}"`
    }
  });
});
