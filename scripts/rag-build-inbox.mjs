// Deterministic RAG inbox builder: corpus/ law JSONs (operator-attested
// mirror drops, sha256-pinned in corpus/SOURCES.json) → var/rag/inbox/<lawId>/
// {source.txt, manifest.json}.
//
// Why a builder: the pipeline consumes plain "txt" sources (sourceType txt
// only — OCR/PDF deferred). This step is the offline sourcing step of the
// runbook (DELIVERABLES §7.5 steps 1–4) applied to the corpus we already
// hold. It is deterministic: same corpus bytes → byte-identical source.txt →
// the sha256 in the generated manifest always matches, so re-runs are
// idempotent at the manifestHash level.
//
// Honesty rules baked in here (do not "improve" them away):
//   - attestation: FALSE — these are mirror-class sources (one step removed
//     from the gazette), NOT verified MOJ/gazette PDFs. The pipeline treats
//     unattested drops as provisional (never LIVE).
//   - issueNo "MIRROR-<lawId>" and publishDate = the mirror snapshot date —
//     NOT the original gazette identity. Pinning that identity is the
//     lawyer's Phase 0 job.
//   - amendment provenance labels inside article text are kept verbatim.
//
// Usage: node scripts/rag-build-inbox.mjs [--out var/rag/inbox] [--corpus corpus] [--force]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const CORPUS = resolve(process.argv.includes('--corpus') ? process.argv[process.argv.indexOf('--corpus') + 1] : 'corpus');
const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'var/rag/inbox');
const FORCE = process.argv.includes('--force');

const sources = JSON.parse(readFileSync(join(CORPUS, 'SOURCES.json'), 'utf8'));
const ws = (s) => String(s).replace(/\s+/g, ' ').trim();

for (const f of sources.files) {
  const raw = JSON.parse(readFileSync(join(CORPUS, f.path), 'utf8'));
  if (raw.verified_official !== false) {
    console.error(`✘ ${f.path} claims verified_official=true — refuse to build an inbox drop from it (verification only via /api/kb/audit)`);
    continue;
  }

  // ---- deterministic source.txt: "المادة N" headers + verbatim article text ----
  const arts = raw.articles
    .map((a) => {
      const m = String(a.article_number_raw).match(/^(\d+)/);
      if (!m) return null;
      const text = ws(a.text_ar || '');
      if (text.length < 5) return null;
      return { no: m[1], text };
    })
    .filter(Boolean);
  const body = arts.map((a) => `المادة ${a.no}\n${a.text}`).join('\n\n');
  const sourceTxt = `${raw.law_name_ar}\n${raw.law_name_en}\n\n${body}\n`;
  const sha = createHash('sha256').update(Buffer.from(sourceTxt, 'utf8')).digest('hex');

  const dir = join(OUT, f.lawId.replace('/', '_'));
  mkdirSync(dir, { recursive: true });
  const txtPath = join(dir, 'source.txt');
  const manPath = join(dir, 'manifest.json');

  if (existsSync(manPath) && !FORCE) {
    const existing = JSON.parse(readFileSync(manPath, 'utf8'));
    if (existing.sourceSha256 === sha) { console.log(`= ${f.lawId}: inbox drop already current`); continue; }
    console.log(`~ ${f.lawId}: corpus changed (sha mismatch) — rebuilding drop`);
  }

  writeFileSync(txtPath, sourceTxt);
  const manifest = {
    manifestVersion: '1',
    issueNo: `MIRROR-${f.lawId}`,
    publishDate: raw.retrieved_at || sources.operator?.name?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || new Date().toISOString().slice(0, 10),
    sourceType: 'txt',
    sourcePath: 'source.txt',
    sourceSha256: sha,
    laws: [{ lawId: f.lawId, lawNameAr: f.lawNameAr, expectedArticleCount: arts.length }],
    operator: {
      name: 'almizanpro-del (corpus mirror drop, built by scripts/rag-build-inbox.mjs)',
      attestation: false
    },
    notes:
      `PROVISIONAL mirror source — NOT the official gazette text. Built deterministically from corpus/${f.path} ` +
      `(sha256-pinned in corpus/SOURCES.json; mirror: ${f.mirrorLawId}). issueNo/publishDate are mirror-snapshot ` +
      `metadata, not the Al-Kuwait Al-Yawm identity — a lawyer must pin the real gazette issue in Phase 0 before ` +
      `any LIVE status. attestation=false accordingly.`
  };
  writeFileSync(manPath, JSON.stringify(manifest, null, 2));
  console.log(`✔ ${f.lawId}: ${arts.length} articles → ${join(dir, '{source.txt,manifest.json}')} (sha ${sha.slice(0, 12)}…, attestation=false)`);
}
console.log('\ninbox ready — dry-run first:');
console.log('  node scripts/rag-ingest.mjs --scan var/rag/inbox --dry-run');
console.log('  node scripts/rag-ingest.mjs --scan var/rag/inbox');
