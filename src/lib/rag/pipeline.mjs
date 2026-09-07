// Manifest-driven ingestion pipeline (docs/RAG_SPEC.md §1.2/§2, manifest
// schema v1) — shared core for scripts/rag-ingest.mjs (CLI) and
// POST /api/rag/ingest (server). Operator-driven only: the caller supplies
// the manifest + source bytes; this module never fetches anything.
//
// State machine (txt sourceType — no OCR in Phase 1):
//   DISCOVERED → REJECTED            (manifest invalid / sha mismatch / no anchors)
//             → BLOCKED_POLICY       (Decree-Law 80/2026 — terminal, never ingestible)
//             → CHUNKED → LINKED → EMBEDDED? → LAWYER_REVIEW (unattested source, terminal here)
//                                           → INDEXED        (attested source)
// `attestation` semantics (manifest.schema.json): true = operator attests an
// authorized channel. A FALSE attestation marks the drop as a provisional
// mirror source: chunks stay retrievable as proposals but the job can never
// reach INDEXED/LIVE and every hit is flagged provisionalSource — the honest
// path for mirror-class corpora (corpus/SOURCES.json) until a lawyer pins
// the gazette identity in Phase 0.

import {
  ensureRagSchema, getJobByManifestHash, insertJob, updateJob,
  closeSupersededChunks, insertChunk, insertAmendmentRecord, linkChunkToProvision,
  setChunkProvision, getChunkByHash, manifestHash, sha256Hex, cuidish, nowIso, BLOCKED_LAWS
} from './store.mjs';
import { chunkLawText, detectAmendmentAction } from './chunker.mjs';
import { embedBatch, embedConfigured } from './embed.mjs';
import { bustRetrievalCache } from './retriever.mjs';

export { BLOCKED_LAWS };

const LAW_ID_RE = /^[0-9]+\/[0-9]{4}$|^[A-Z]+(\/[0-9]{4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a manifest against docs/rag/schemas/manifest.schema.json (v1). */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest must be an object'] };
  const req = (k) => { if (m[k] === undefined || m[k] === null || m[k] === '') errors.push(`missing required field: ${k}`); };
  req('manifestVersion'); req('issueNo'); req('publishDate'); req('sourceType'); req('sourcePath'); req('sourceSha256'); req('laws'); req('operator');
  if (m.manifestVersion !== undefined && m.manifestVersion !== '1') errors.push('manifestVersion must be "1"');
  if (m.publishDate !== undefined && !DATE_RE.test(String(m.publishDate))) errors.push('publishDate must be YYYY-MM-DD');
  if (m.sourceType !== undefined && !['pdf', 'txt'].includes(m.sourceType)) errors.push('sourceType must be pdf|txt');
  if (m.sourceType === 'pdf') errors.push('sourceType "pdf" is not supported in Phase 1 (txt only — OCR explicitly deferred; see docs/rag/IMPLEMENTATION_STATUS.md)');
  if (m.sourceSha256 !== undefined && !/^[a-f0-9]{64}$/.test(String(m.sourceSha256))) errors.push('sourceSha256 must be 64 hex chars');
  if (m.laws !== undefined) {
    if (!Array.isArray(m.laws) || m.laws.length < 1) errors.push('laws must be a non-empty array');
    else for (const l of m.laws) {
      if (!l || typeof l !== 'object') { errors.push('laws[] entries must be objects'); break; }
      if (!l.lawId || !LAW_ID_RE.test(l.lawId)) errors.push(`laws[].lawId "${l.lawId}" does not match the repo convention`);
      if (!l.lawNameAr) errors.push('laws[].lawNameAr is required');
    }
  }
  if (m.operator !== undefined) {
    if (!m.operator || typeof m.operator !== 'object' || !m.operator.name) errors.push('operator.name is required');
    if (!m.operator || typeof m.operator.attestation !== 'boolean') errors.push('operator.attestation must be a boolean (true = authorized channel; false = provisional mirror source)');
  }
  return { ok: errors.length === 0, errors };
}

const statsJson = (s) => JSON.stringify(s);

/**
 * Run one manifest through the pipeline.
 * @param ctx storage ctx { dialect, all, run, exec }
 * @param args { manifest, sourceText, dryRun, operator (actor name), audit(action, detail) }
 */
export async function runIngest(ctx, args) {
  await ensureRagSchema(ctx);
  const { manifest, sourceText, dryRun = false, operator = 'system', audit } = args;

  // ---- validate (fail before any write) ----
  const v = validateManifest(manifest);
  if (!v.ok) {
    return { ok: false, stage: 'REJECTED', errors: v.errors, report: { reason: 'manifest invalid', errors: v.errors } };
  }
  const mHash = manifestHash(manifest);
  const attested = manifest.operator.attestation === true;
  const blockedLaws = (manifest.laws || []).filter((l) => BLOCKED_LAWS.has(l.lawId));

  // ---- idempotency (RAG-16): same manifest re-run = no-op ----
  const existing = await getJobByManifestHash(ctx, mHash);
  if (existing && !dryRun) {
    let stats = {};
    try { stats = JSON.parse(existing.stats || '{}'); } catch { /* keep {} */ }
    return { ok: true, idempotent: true, stage: existing.status, jobId: existing.id, stats };
  }

  // ---- policy block: Decree-Law 80/2026 (RAG-15) — recorded, never ingested ----
  if (blockedLaws.length) {
    const job = {
      id: cuidish(), manifestHash: mHash, issueNo: manifest.issueNo, publishDate: manifest.publishDate,
      sourceType: manifest.sourceType, sourcePath: manifest.sourcePath, sourceSha256: manifest.sourceSha256,
      status: 'BLOCKED_POLICY', attested, createdBy: operator, createdAt: nowIso(),
      stats: statsJson({ blocked: blockedLaws.map((l) => l.lawId), policy: 'Decree-Law 80/2026 excluded (README.md:17)' })
    };
    if (!dryRun) {
      await insertJob(ctx, job);
      await audit?.('rag.ingest.blocked_policy', `issue ${manifest.issueNo}: ${blockedLaws.map((l) => l.lawId).join(', ')} (hard blocklist)`);
    }
    return { ok: false, stage: 'BLOCKED_POLICY', jobId: dryRun ? null : job.id, blocked: blockedLaws.map((l) => l.lawId), report: job.stats };
  }

  // ---- source integrity ----
  const actualSha = sha256Hex(Buffer.from(String(sourceText ?? ''), 'utf8'));
  if (actualSha !== manifest.sourceSha256) {
    const reason = `sha256 mismatch: manifest says ${manifest.sourceSha256}, source bytes are ${actualSha}`;
    const job = {
      id: cuidish(), manifestHash: mHash, issueNo: manifest.issueNo, publishDate: manifest.publishDate,
      sourceType: manifest.sourceType, sourcePath: manifest.sourcePath, sourceSha256: manifest.sourceSha256,
      status: 'REJECTED', attested, createdBy: operator, createdAt: nowIso(), stats: statsJson({ reason })
    };
    if (!dryRun) {
      await insertJob(ctx, job);
      await audit?.('rag.ingest.rejected', `issue ${manifest.issueNo}: ${reason}`);
    }
    return { ok: false, stage: 'REJECTED', jobId: dryRun ? null : job.id, report: { reason } };
  }

  // ---- chunk every law in the manifest against the single source text ----
  // (one source file may carry several laws; chunkLawText anchors per article
  // and the manifest's law list attributes the file — Phase 1 drops are
  // one-law-per-file, so chunk each law entry and take the non-empty result.)
  let best = null;
  for (const law of manifest.laws) {
    const r = chunkLawText({
      lawId: law.lawId, text: sourceText,
      gazetteRef: { issueNo: `MIRROR-${law.lawId}`, publishDate: manifest.publishDate }
    });
    if (!best || r.chunks.length > best.r.chunks.length) best = { law, r };
  }
  const { law: primaryLaw, r: chunked } = best;
  if (!chunked.chunks.length) {
    // Harness gate: "chunks: 0 with 'no article anchors found'" must be
    // investigated, never papered over with an invented fallback.
    const reason = `no article anchors found in ${manifest.sourcePath} (chunker did not recognize the text structure)`;
    const job = {
      id: cuidish(), manifestHash: mHash, issueNo: manifest.issueNo, publishDate: manifest.publishDate,
      sourceType: manifest.sourceType, sourcePath: manifest.sourcePath, sourceSha256: manifest.sourceSha256,
      status: 'REJECTED', attested, createdBy: operator, createdAt: nowIso(), stats: statsJson({ reason })
    };
    if (!dryRun) {
      await insertJob(ctx, job);
      await audit?.('rag.ingest.rejected', `issue ${manifest.issueNo}: ${reason}`);
    }
    return { ok: false, stage: 'REJECTED', jobId: dryRun ? null : job.id, report: { reason, stats: chunked.stats } };
  }

  // ---- QA: expected article count sanity (warning, not rejection — the
  // lawyer reconciles in Phase 0) + intra-manifest dedupe on textHash ----
  const stats = {
    issueNo: manifest.issueNo, publishDate: manifest.publishDate,
    laws: [], anchors: chunked.stats.anchors, anchorSource: chunked.stats.anchorSource,
    parts: chunked.stats.parts, chapters: chunked.stats.chapters,
    amendmentHits: 0, supersededWindows: 0, embedded: 0, provisionalSource: !attested,
    expectedArticleCount: primaryLaw.expectedArticleCount ?? null,
    warnings: []
  };
  if (primaryLaw.expectedArticleCount && Math.abs(chunked.stats.anchors - primaryLaw.expectedArticleCount) > Math.max(5, primaryLaw.expectedArticleCount * 0.1)) {
    stats.warnings.push(`anchor count ${chunked.stats.anchors} vs expected ${primaryLaw.expectedArticleCount} — reconcile in Phase 0`);
  }

  // ---- job row (status advances as gates pass) ----
  const jobId = cuidish();
  const jobBase = {
    id: jobId, manifestHash: mHash, issueNo: manifest.issueNo, publishDate: manifest.publishDate,
    sourceType: manifest.sourceType, sourcePath: manifest.sourcePath, sourceSha256: manifest.sourceSha256,
    status: 'CHUNKED', attested, createdBy: operator, createdAt: nowIso()
  };

  const perLaw = { lawId: primaryLaw.lawId, lawNameAr: primaryLaw.lawNameAr, chunks: chunked.chunks.length, embedded: 0, linked: 0 };

  if (!dryRun) {
    await insertJob(ctx, { ...jobBase, stats: statsJson(stats) });

    // embed (local-only; null when the service is down — lexical-only mode)
    if (embedConfigured()) {
      const embeddings = await embedBatch(chunked.chunks.map((c) => c.textCanonical));
      chunked.chunks.forEach((c, i) => { c.embedding = embeddings[i]; });
    }

    for (const c of chunked.chunks) {
      // Content identity check FIRST: if this exact text already exists for
      // (law, article, part), it is the same chunk re-published — never
      // regress its window (an older issue must not close a newer text's
      // validity), only (re)link the LKB pointer.
      const existing = await getChunkByHash(ctx, {
        lawId: c.lawId, articleNo: c.articleNo, articlePart: c.articlePart, textHash: c.textHash
      });

      // chunk-level version chain: close the window of older text for the
      // same (law, article, part) — append-only, text never mutated (RAG-17).
      // Only done when this ingest carries genuinely NEW text.
      if (!existing) {
        const closed = await closeSupersededChunks(ctx, {
          lawId: c.lawId, articleNo: c.articleNo, articlePart: c.articlePart,
          publishDate: manifest.publishDate, excludeTextHash: c.textHash
        });
        stats.supersededWindows += closed;
      }

      // LINKED: pointer to the active LKB provision (read-only linkage)
      const prov = await linkChunkToProvision(ctx, { lawId: c.lawId, articleNo: c.articleNo });
      if (prov) perLaw.linked++;

      if (existing) {
        // same content: keep the original row (and its window); if it was
        // never linked to the LKB, link it now
        if (prov && !existing.provision_id) await setChunkProvision(ctx, existing.id, prov.id);
        stats.skippedExisting = (stats.skippedExisting || 0) + 1;
        continue;
      }

      const inserted = await insertChunk(ctx, {
        id: cuidish(),
        provisionId: prov?.id ?? null,
        lawId: c.lawId, articleNo: c.articleNo, articlePart: c.articlePart,
        chapterHeading: c.chapterHeading, amendmentVersion: c.amendmentVersion,
        effectiveFrom: manifest.publishDate, effectiveTo: null,
        gazetteIssue: c.gazetteIssue, gazetteDate: c.gazetteDate,
        textCanonical: c.textCanonical, textNormalized: c.textNormalized, textHash: c.textHash,
        embedding: c.embedding ?? null,
        ocrEngine: 'text-born',
        ingestJobId: jobId,
        status: c.embedding ? 'EMBEDDED' : 'CHUNKED'
      });
      if (inserted && c.embedding) perLaw.embedded++;

      // amendment formulas are RECORDED, never applied (lawyer-gated, RAG-17)
      const action = detectAmendmentAction(c.textCanonical);
      if (action) {
        stats.amendmentHits++;
        await insertAmendmentRecord(ctx, {
          targetLawId: c.lawId, targetArticle: c.articleNo, action,
          gazetteIssue: c.gazetteIssue, gazetteDate: c.gazetteDate, ingestJobId: jobId
        });
      }
    }

    stats.laws = [perLaw];
    const finalStatus = perLaw.embedded > 0 ? 'EMBEDDED' : 'CHUNKED';
    await updateJob(ctx, jobId, attested ? (finalStatus === 'EMBEDDED' ? 'INDEXED' : 'LAWYER_REVIEW') : 'LAWYER_REVIEW', stats);
    await audit?.(
      'rag.ingest',
      `issue ${manifest.issueNo} (${manifest.publishDate}): ${perLaw.chunks} chunks for ${perLaw.lawId} — ` +
      `${perLaw.embedded} embedded, ${perLaw.linked} linked to LKB, attested=${attested}` +
      (attested ? '' : ' — PROVISIONAL mirror source (never LIVE until re-attested)')
    );
    bustRetrievalCache();
  } else {
    stats.laws = [perLaw];
  }

  return {
    ok: true,
    stage: dryRun ? 'DRY_RUN' : (attested ? 'INDEXED' : 'LAWYER_REVIEW'),
    jobId: dryRun ? null : jobId,
    dryRun,
    stats,
    chunks: perLaw.chunks
  };
}
