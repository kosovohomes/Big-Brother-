import { NextRequest } from 'next/server';
import {json, requireOrg, notFound, withOrg } from '@/lib/api-helpers';
import { cuidish, nowIso, sha256, mapDocument, audit, getDriver } from '@/lib/db';
import { flags } from '@/lib/config';
import { getOrCreateOrgDek } from '@/lib/crypto';
import { ensureBucket, putObject, virusScan } from '@/lib/storage/object-store';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/cases/:id/voice-note — Voice-note intake (PRD 5.1 AC4 / Change 13):
// a first-class onboarding path for users with low digital or written
// literacy, NOT gated behind NGO Mode. The audio is sealed into the immutable
// evidence log (SHA-256) — and with OBJECT_STORAGE_ENABLED=true the audio
// bytes take the same A3 path as document originals (SSE-C + WORM, A3.2).
// The consent 428 gate is preserved verbatim (PRD 5.1 AC3/AC4). The server
// transcribes the spoken description via ASR (z-ai-web-dev-sdk); if
// transcription is unavailable the note remains sealed — graceful fallback.
export const POST = withOrg(async function(req: NextRequest, ctx: Ctx) {
  const guard = await requireOrg(req);
  if ('error' in guard) return guard.error;
  const d = await getDriver();
  const { id } = await ctx.params;
  const row = await d.prepare('SELECT id FROM cases WHERE id = ? AND org_id = ?').get(id, guard.ctx.orgId);
  if (!row) return notFound('case');

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: 'empty audio upload' }, 400);
  if (buf.length > 15 * 1024 * 1024) return json({ error: 'audio too large (max 15 MB)' }, 413);

  const consent = req.headers.get('x-voice-consent');
  if (consent !== '1') {
    return json({ error: 'voice-note consent required (PRD 5.1 AC3/AC4)', detail: 'The consent screen must be accepted before a voice note is stored.' }, 428);
  }

  const name = decodeURIComponent(req.headers.get('x-file-name') || 'voice-note.webm');
  const mime = req.headers.get('content-type') || 'audio/webm';
  const hash = sha256(buf);
  const docId = cuidish();
  const scan = await virusScan(buf);
  if (scan === 'infected') {
    await audit('document.infected', `${name} (voice-note) rejected by scanner`, guard.ctx.orgId, guard.ctx.uid);
    return json({ error: 'upload rejected: antivirus scan flagged the file' }, 422);
  }

  let storageFields: Record<string, string | null> = {
    storage_key: null, storage_version_id: null, storage_class: null, retention_until: null
  };
  if (flags.objectStorageEnabled()) {
    const bucketCheck = await ensureBucket();
    if (!bucketCheck.ok) return json({ error: 'object storage unavailable', detail: bucketCheck.detail }, 502);
    const orgDek = (await getOrCreateOrgDek(guard.ctx.orgId)).dek;
    const objectKey = `${guard.ctx.orgId}/${id}/${docId}/v1-${hash}`;
    const retentionUntil = new Date(Date.now() + flags.docRetentionYears() * 365 * 86400000);
    const put = await putObject(objectKey, buf, { orgDek, retentionUntil, contentType: mime });
    if (!put.ok) return json({ error: 'object storage write failed', detail: put.error }, 502);
    storageFields = {
      storage_key: `s3://${flags.s3().bucket}/${objectKey}`,
      storage_version_id: put.versionId ?? null,
      storage_class: 'STANDARD',
      retention_until: retentionUntil.toISOString()
    };
  }

  await d.prepare(`INSERT INTO documents (id, case_id, name, hash, size, mime, hashed_at, meta_risk, notes, version, previous_id, created_at,
              storage_key, storage_version_id, storage_class, retention_until, virus_scan_status)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(docId, id, name, hash, buf.length, mime, nowIso(), 'LOW',
      storageFields.storage_key ? 'Voice-note intake (original sealed to object storage, DEK-encrypted)' : 'Voice-note intake (sealed, content not stored server-side)',
      1, null, nowIso(),
      storageFields.storage_key, storageFields.storage_version_id, storageFields.storage_class,
      storageFields.retention_until, scan);
  await d.prepare('INSERT INTO consents (id, user_id, case_id, scope, version, text_snapshot, accepted_at) VALUES (?,?,?,?,?,?,?)')
    .run(cuidish(), guard.ctx.uid, id, 'voice_note', 'v2.1',
      'أوافق على معالجة تسجيلي الصوتي لتحويله إلى نص لاستكمال بيانات قضيتي. / I consent to processing my voice recording to transcribe it for my case intake.', nowIso());
  await audit('voicenote.seal', `${id} ${hash.slice(0, 12)}`, guard.ctx.orgId, guard.ctx.uid);

  // --- ASR transcription (server-side only, graceful fallback) ---
  let transcript = '';
  let transcriptOk = false;
  try {
    const mod = await import('z-ai-web-dev-sdk');
    const ZAI = (mod as unknown as { default: { create: () => Promise<{ audio: { asr: { create: (args: { file_base64: string }) => Promise<{ text?: string }> } } }> } }).default;
    const zai = await ZAI.create();
    const response = await zai.audio.asr.create({ file_base64: buf.toString('base64') });
    transcript = (response?.text || '').trim();
    transcriptOk = transcript.length > 0;
  } catch (err) {
    transcript = '';
    transcriptOk = false;
    await audit('voicenote.asr.fallback', String(err).slice(0, 200), guard.ctx.orgId, guard.ctx.uid);
  }

  return json({
    ok: true,
    document: mapDocument(await d.prepare('SELECT * FROM documents WHERE id = ?').get(docId)),
    transcript,
    transcriptOk,
    fallback: transcriptOk
      ? null
      : 'تعذّر التحويل الآلي — يمكن إدخال الوصف كتابيًا أو لاحقًا بواسطة عاملة الحالة. / Automatic transcription unavailable — enter the description manually or via a caseworker later.'
  }, 201);

});
