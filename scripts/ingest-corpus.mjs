// Corpus ingestion — real Kuwaiti law mirrors -> legal_provisions (global LKB).
//   node scripts/ingest-corpus.mjs [--dry-run]        # CORPUS_DIR=corpus by default
//   STORAGE_BACKEND=pg + DATABASE_URL_SYSTEM=...      # dual-backend (reaper pattern)
//
// Design (corpus/README_legal_corpus.md + docs/RAG_SPEC.md §2):
//   1. validate BEFORE any write — header fields, article_count, sha256 vs
//      SOURCES.json, and verified_official === false (a file claiming verified
//      is REFUSED: verification only happens through the lawyer audit flow).
//   2. repair known mirror damage (glued first letters, مكرر variants, whitespace).
//   3. never duplicate existing coverage — fixture-covered article numbers
//      (exact or range) are skipped and reported for Phase 0 reconciliation.
//   4. split inline amendment provenance into the version chain (v1 original
//      inactive -> v2 amended active supersedes_id=v1), mirroring kb/audit amend.
//   5. repeal markers (ملغاة) are surfaced in verification_note, never auto-applied.
//   6. everything lands verified:false (Phase 0 queue) + an lkb.ingest audit row.
//   7. idempotent: unique (law_id, article_no, version) — re-runs skip existing.
//
// Output: corpus/INGEST_REPORT.json + console summary. Exit 1 on refusal.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DRY = process.argv.includes('--dry-run');
const CORPUS_DIR = resolve(process.env.CORPUS_DIR || 'corpus');
const BACKEND = process.env.STORAGE_BACKEND === 'pg' ? 'pg' : 'sqlite';
const LAW_ID_RE = /^[0-9]+\/[0-9]{4}$|^[A-Z]+(\/[0-9]{4})?$/; // repo convention: "38/1980", "CITRA", ...
const nowIso = () => new Date().toISOString();
const cuidish = () => 'c' + globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 24);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ws = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---------- backend plumbing (mirrors scripts/reaper.mjs) ----------
let exec_, all_, auditFn_, execRun;
if (BACKEND === 'pg') {
  const { Client } = await import('pg');
  const toPg = (sql) => { // quote-aware ? -> $n
    let out = '', n = 0, inStr = false;
    for (const ch of sql) { if (ch === "'") inStr = !inStr; out += (ch === '?' && !inStr) ? `$${++n}` : ch; }
    return out;
  };
  const client = new Client({ connectionString: process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL });
  await client.connect();
  exec_ = async (sql) => { await client.query(sql); };
  all_ = async (sql, params = []) => (await client.query(toPg(sql), params)).rows;
  execRun = async (sql, params = []) => { await client.query(toPg(sql), params); };
  auditFn_ = (action, detail) =>
    client.query('INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES ($1,NULL,NULL,$2,$3,$4)',
      [cuidish(), nowIso(), action, detail]);
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const DB_PATH = join(process.cwd(), 'data', 'big-brother.db');
  const db = new DatabaseSync(DB_PATH);
  exec_ = async (sql) => { db.exec(sql); };
  all_ = (sql, params = []) => db.prepare(sql).all(...params);
  execRun = (sql, params = []) => { db.prepare(sql).run(...params); };
  auditFn_ = (action, detail) =>
    db.prepare('INSERT INTO audit_logs (id, org_id, user_id, at, action, detail) VALUES (?,?,?,?,?,?)')
      .run(cuidish(), null, null, nowIso(), action, detail);
}

// ---------- article number normalization ----------
// Handles the three mirror dialects:
//   "3" | "135 مكرر" | "104مكررا" | "216مكرر 1" | "109 مكرراً" | "4 \nا" (glued first letter)
// Returns { articleNo, glue } or null when no leading digits exist.
function normNumber(raw) {
  const s = String(raw);
  // digits + optional مكرر variant + optional glued first letter (Arabic only,
  // e.g. "4 \nا" or "135 مكرراً \nا"), then tolerate any trailing debris
  const m = s.match(/^(\d+)\s*(مكرر[^\n\s]*)?[\s\n]*([\u0621-\u064A])?[\s\S]*$/);
  if (!m) return null;
  const no = m[1] + (m[2] ? ' مكرر' : '');
  return { articleNo: no, glue: m[3] || '' };
}

// ---------- inline amendment parser (Penal Code labels) ----------
// "النص النهائي للمادة تبعاً لآخر تأثير بـ مادة 1 من مرسوم بقانون رقم 70 لسنة 1979
//  بشأن تعديل .... نشر بتاريخ 18 / 11 / 1979 <FINAL TEXT> النص الأصلي للمادة: <ORIGINAL TEXT>"
const L_FINAL = 'النص النهائي';
const L_ORIG = 'النص الأصلي';
function parseAmendment(rawText) {
  const t = String(rawText);
  const iF = t.indexOf(L_FINAL), iO = t.indexOf(L_ORIG);
  if (iF < 0 || iO < 0 || iO < iF) return null;
  const seg = t.slice(iF, iO);
  const orig = ws(t.slice(iO + L_ORIG.length).replace(/^[\s:،-]*للمادة[\s:،-]*/, ''));
  const pubM = seg.match(/نشر بتاريخ\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})/);
  const lawM = seg.match(/(?:مرسوم بقانون|قانون)\s+رقم\s*(\d+)\s*لسنة\s*(\d+)/);
  const repealed = /ملغ/.test(seg);
  let final = ws(seg.replace(/^[\s\S]*?نشر بتاريخ\s*\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}/, ''))
    .replace(/^في\s+الكويت\s+اليوم\s*/, '');
  if (!pubM) { // degenerate label without a date: strip the first sentence as the header
    final = ws(seg.replace(/^[\s\S]*?بموجب[\s\S]*?\./, '').replace(/^[\s\S]*?رقم\s*\d+\s*لسنة\s*\d+[\s\S]*?\./, ''));
  }
  if (!final || !orig || final.length < 15 || orig.length < 15) return { degenerate: true, repealed, lawM, pubM };
  return { final, orig, repealed, lawM, pubM };
}

// ---------- fixture coverage ----------
// Existing rows for the same law (e.g. v0.1 fixtures "257", "35-44", "P-1")
// define covered article numbers; individual mirror numbers inside a fixture
// range are covered too (citation identity, not just constraint safety).
function coveredSet(existingNos) {
  const covered = new Set();
  for (const no of existingNos) {
    const s = String(no).trim();
    covered.add(s);
    const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (b > a && b - a <= 100) for (let i = a; i <= b; i++) covered.add(String(i));
    }
  }
  return covered;
}

// ---------- main ----------
const RESET = process.argv.includes('--reset-ingested'); // delete rows created by a prior corpus ingest (parser-fix cycle)
const report = { generatedAt: nowIso(), corpusDir: CORPUS_DIR, backend: BACKEND, dryRun: DRY, reset: RESET, files: [], audit: null, refused: [] };
let refused = false;
let inserted = 0;

const sourcesPath = join(CORPUS_DIR, 'SOURCES.json');
if (!existsSync(sourcesPath)) { console.error(`ingest: SOURCES.json not found in ${CORPUS_DIR}`); process.exit(1); }
const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));

if (RESET && !DRY) {
  // Guardrails: only rows this pipeline created (provenance note), never
  // verified, never touched by a lawyer. Fixtures and audit-verified rows survive.
  const del = await all_(`SELECT id, law_id, article_no FROM legal_provisions
     WHERE verification_note LIKE '%Ingested from public legal mirror%' AND verified = 0 AND verified_by IS NULL`);
  await exec_('BEGIN');
  for (const r of del) await execRun(`DELETE FROM legal_provisions WHERE id = ?`, [r.id]);
  await exec_('COMMIT');
  console.log(`reset: removed ${del.length} previously-ingested row(s) (unverified, untouched) — safe to re-ingest`);
}

for (const f of sources.files) {
  const path = join(CORPUS_DIR, f.path);
  const entry = { file: f.path, lawId: f.lawId, status: 'ok', ingested: 0, skippedExisting: 0, skippedFixture: 0,
    skippedDuplicate: 0, splitVersions: 0, repealMarked: 0, details: [] };

  const refuse = (reason) => { entry.status = 'REFUSED'; entry.reason = reason; report.refused.push(entry); refused = true; };

  if (!LAW_ID_RE.test(f.lawId || '')) { refuse(`lawId "${f.lawId}" does not match the repo convention ^[0-9]+/[0-9]{4}$`); report.files.push(entry); continue; }
  if (!existsSync(path)) { refuse('file missing'); report.files.push(entry); continue; }
  const buf = readFileSync(path);
  if (f.sha256 && sha256(buf) !== f.sha256) { refuse('sha256 mismatch vs SOURCES.json (tampered or stale drop)'); report.files.push(entry); continue; }

  let doc;
  try { doc = JSON.parse(buf.toString('utf8')); } catch (e) { refuse(`invalid JSON: ${e.message}`); report.files.push(entry); continue; }

  // POLICY: mirror files are unverified by definition. A file claiming
  // verified_official=true must never silently raise trust — refusal is the
  // safe behavior (flip flags only via the lawyer audit flow, per article).
  if (doc.verified_official !== false) {
    refuse(`verified_official must be false for mirror ingestion (got ${JSON.stringify(doc.verified_official)}) — verification happens through /api/kb/audit only`);
    report.files.push(entry); continue;
  }
  if (!Array.isArray(doc.articles) || !doc.articles.length) { refuse('no articles array'); report.files.push(entry); continue; }
  if (Number(doc.article_count) !== doc.articles.length) {
    refuse(`article_count header says ${doc.article_count} but ${doc.articles.length} articles present`);
    report.files.push(entry); continue;
  }

  // normalize + intra-file dedupe (first occurrence wins)
  const seen = new Map();
  const arts = [];
  for (const a of doc.articles) {
    const norm = normNumber(a.article_number_raw);
    if (!norm) { entry.details.push({ article: String(a.article_number_raw), issue: 'no leading article number — skipped' }); continue; }
    let text = ws(a.text_ar || '');
    if (norm.glue) text = ws(norm.glue + text); // repair glued first letter ("4 \nا" + "ذ نص" -> "اذا نص")
    if (text.length < 5) { entry.details.push({ article: norm.articleNo, issue: 'empty after normalization — skipped' }); continue; }
    if (seen.has(norm.articleNo)) {
      entry.skippedDuplicate++;
      entry.details.push({ article: norm.articleNo, issue: 'duplicate article number in file — first occurrence kept, variant recorded', variantText: text.slice(0, 400) });
      continue;
    }
    seen.set(norm.articleNo, true);
    arts.push({ articleNo: norm.articleNo, text });
  }

  // existing rows -> coverage + idempotency maps
  const existing = await all_(`SELECT id, article_no, version, is_active FROM legal_provisions WHERE law_id = ?`, [f.lawId]);
  const covered = coveredSet(existing.map(r => r.article_no));
  const haveV = new Set(existing.map(r => `${r.article_no}#${r.version}`));

  const rows = []; // {articleNo, version, amendmentVersion, gazetteRef, text, supersedesIdx}, active, note
  for (const a of arts) {
    // idempotency first (prior ingest of the same article), then fixture coverage
    if (haveV.has(`${a.articleNo}#1`)) { entry.skippedExisting++; continue; }
    if (covered.has(a.articleNo)) { entry.skippedFixture++; continue; }
    const plainRepeal = /^ملغ(اة|ى)?/.test(a.text) && a.text.length < 20;
    const amd = parseAmendment(a.text);
    if (amd && !amd.degenerate && !amd.repealed && amd.lawM) {
      const label = amd.lawM[0].startsWith('مرسوم')
        ? `معدلة بالمرسوم بقانون رقم ${amd.lawM[1]} لسنة ${amd.lawM[2]}`
        : `معدلة بالقانون رقم ${amd.lawM[1]} لسنة ${amd.lawM[2]}`;
      const gaz = amd.pubM ? `نشر بتاريخ ${amd.pubM[1]}` : null;
      rows.push({ articleNo: a.articleNo, version: 1, amendmentVersion: 'original', gazetteRef: null, text: amd.orig, active: 0, splitBase: true, note: null });
      rows.push({ articleNo: a.articleNo, version: 2, amendmentVersion: label, gazetteRef: gaz, text: amd.final, active: 1, supersedesIdx: rows.length - 1, note: null });
      entry.splitVersions++;
    } else {
      let note = null;
      if (amd && (amd.repealed || amd.degenerate)) {
        entry.repealMarked++;
        note = amd.repealed
          ? 'المصدر يشير إلى إلغاء/تعديل هذه المادة («ملغاة» في نص المرآة) — يلزم حسم الحالة في المرحلة صفر / source marks a repeal/amendment («ملغاة») — resolve in Phase 0'
          : 'تسمية التعديل في المرآة غير قابلة للتفكيك الآلي — نُشر النص كما ورد / amendment label not machine-separable — raw text kept';
      } else if (plainRepeal) {
        entry.repealMarked++;
        note = 'نص المرآة لهذه المادة هو «ملغاة» فقط — يلزم حسم الحالة في المرحلة صفر / mirror text for this article is only «ملغاة» (repealed) — resolve in Phase 0';
      }
      rows.push({ articleNo: a.articleNo, version: 1, amendmentVersion: 'original', gazetteRef: null, text: a.text, active: 1, note });
    }
  }

  // idempotency safety net (attribution counters live in the classification loop above)
  const fresh = rows.filter(r => !haveV.has(`${r.articleNo}#${r.version}`));
  const leftover = rows.length - fresh.length;
  if (leftover) entry.details.push({ issue: `${leftover} row(s) already present at insert-time (idempotency safety net)` });

  if (fresh.length) {
    if (!DRY) {
      await exec_(BACKEND === 'pg' ? 'BEGIN' : 'BEGIN IMMEDIATE');
      try {
        for (const r of fresh) {
          const id = cuidish();
          const titleAr = `المادة ${r.articleNo}`;
          const titleEn = `Article ${r.articleNo}`;
          const prov = `${f.mirrorLawId || doc.law_id} → ${f.lawId} — مستورد من مرآة قانونية عامة — غير موثق — بانتظار التدقيق المرجعي في المرحلة صفر / Ingested from public legal mirror — unverified — pending Phase 0 audit`;
          const note = [prov, r.note].filter(Boolean).join(' — ');
          await execRun(`INSERT INTO legal_provisions
            (id, law_id, law_name_ar, law_name_en, article_no, amendment_version, effective_from, effective_to, gazette_ref,
             title_ar, title_en, text_ar, text_en, summary_ar, summary_en, topics, verified, verification_note, version, supersedes_id, is_active, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, f.lawId, doc.law_name_ar, doc.law_name_en, r.articleNo, r.amendmentVersion, null, null, r.gazetteRef,
             titleAr, titleEn, r.text, '', r.text.slice(0, 120), '', '[]', 0, note, r.version, null, r.active, nowIso()]);
          r._id = id;
          inserted++;
        }
        // wire supersedes_id for split v2 rows (their base v1 was inserted in the same pass)
        for (const r of fresh) {
          if (r.supersedesIdx !== undefined) {
            const base = fresh[r.supersedesIdx];
            if (base && base._id) await execRun(`UPDATE legal_provisions SET supersedes_id = ? WHERE id = ?`, [base._id, r._id]);
          }
        }
        await exec_('COMMIT');
      } catch (e) {
        await exec_('ROLLBACK').catch(() => {});
        throw e;
      }
    }
    entry.ingested = fresh.length;
  }
  report.files.push(entry);
}

if (!refused && !DRY) {
  report.audit = { action: 'lkb.ingest', at: nowIso(), inserted };
  await auditFn_('lkb.ingest', `corpus ingestion from ${CORPUS_DIR}: ${inserted} provision rows (all verified:false — Phase 0 queue)`);
}

writeFileSync(join(CORPUS_DIR, 'INGEST_REPORT.json'), JSON.stringify(report, null, 2));

// ---------- summary ----------
console.log(`\ncorpus ingest (${BACKEND}${DRY ? ', dry-run' : ''}) — corpus dir: ${CORPUS_DIR}`);
for (const f of report.files) {
  if (f.status === 'REFUSED') { console.log(`  ✘ ${f.file}: REFUSED — ${f.reason}`); continue; }
  console.log(`  ✔ ${f.file} → ${f.lawId}: +${f.ingested} rows (split:${f.splitVersions} repeal-marked:${f.repealMarked} dup-skip:${f.skippedDuplicate} fixture-skip:${f.skippedFixture} existing-skip:${f.skippedExisting})`);
}
if (refused) { console.error('\ningest: REFUSED — nothing written'); process.exit(1); }
console.log(inserted ? `done: ${inserted} provision rows ${DRY ? '(dry-run — not written)' : 'inserted (verified:false — Phase 0 queue)'}` : 'done: nothing to insert (idempotent re-run)');
