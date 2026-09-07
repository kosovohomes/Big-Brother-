import { NextRequest } from 'next/server';
import { json, readJson, requireOrg, withOrg } from '@/lib/api-helpers';
import { audit } from '@/lib/db';
import { flags } from '@/lib/config';
import { ragCtx } from '@/lib/rag/server-ctx';

// POST /api/rag/ingest — operator-driven manifest ingestion over HTTP
// (RAG_SPEC §4.4). Role gate mirrors the Phase 0 verification discipline:
// LAWYER/ADMIN only (MEMBER/CASEWORKER/OWNER → 403; e2e RAG-01).
//
// Body: { manifest: <manifest v1 object>, dryRun?: boolean }
// The source file is read from the operator inbox (RAG_INBOX, default
// ./var/rag/inbox) relative to the manifest's sourcePath — path traversal is
// rejected; the route never fetches remote content (no scraping, ever).
export const POST = withOrg(async function (req: NextRequest) {
  if (!flags.ragEnabled()) return json({ error: 'rag_disabled' }, 503);
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  if (guard.role !== 'LAWYER' && guard.role !== 'ADMIN') {
    return json({ error: 'forbidden', message: 'RAG ingestion is LAWYER/ADMIN-only (Phase 0 discipline)' }, 403);
  }

  const body = await readJson<{ manifest?: Record<string, unknown>; dryRun?: boolean; dropDir?: string }>(req);
  const manifest = body.manifest;
  if (!manifest || typeof manifest !== 'object') return json({ error: 'manifest_required' }, 400);

  const { runIngest, validateManifest } = await import('@/lib/rag/pipeline.mjs');
  const { ensureRagSchema } = await import('@/lib/rag/store.mjs');

  // validate shape first so a malformed body can't touch the inbox reader
  const pre = validateManifest(manifest);
  if (!pre.ok) return json({ ok: false, stage: 'REJECTED', errors: pre.errors }, 422);

  // safe inbox read: the drop directory and sourcePath must both resolve
  // inside RAG_INBOX — path traversal is rejected
  const inbox = flags.ragInbox();
  const { resolve, sep } = await import('node:path');
  const { readFile } = await import('node:fs/promises');
  const inboxAbs = resolve(inbox);
  const dropDir = String(body.dropDir || '');
  const dropAbs = dropDir ? resolve(inboxAbs, dropDir) : inboxAbs;
  if (dropAbs !== inboxAbs && !dropAbs.startsWith(inboxAbs + sep)) {
    return json({ error: 'source_outside_inbox' }, 400);
  }
  const srcAbs = resolve(dropAbs, String(manifest.sourcePath));
  if (!srcAbs.startsWith(dropAbs + sep) && srcAbs !== dropAbs) {
    return json({ error: 'source_outside_inbox' }, 400);
  }
  let sourceText: string;
  try {
    sourceText = await readFile(srcAbs, 'utf8');
  } catch {
    return json({ error: 'source_missing', detail: `${manifest.sourcePath} not found under the inbox` }, 400);
  }

  const ctx = await ragCtx();
  await ensureRagSchema(ctx);
  const out = await runIngest(ctx, {
    manifest: manifest as Parameters<typeof runIngest>[1]['manifest'],
    sourceText,
    dryRun: body.dryRun === true,
    operator: `${guard.ctx.uid}|${guard.ctx.name ?? 'api'}`,
    audit: (action: string, detail: string) => audit(action, detail, guard.ctx.orgId, guard.ctx.uid)
  });
  if (!out.ok) return json(out, out.stage === 'BLOCKED_POLICY' ? 422 : 400);
  return json(out, body.dryRun ? 200 : 201);
});
