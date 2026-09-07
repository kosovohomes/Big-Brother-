// Re-attach builder (Task 13): rebuild the two wiped law-corpus files from the
// raw mirror snapshots in corpus/_raw/, in the exact _clean.json format that
// scripts/ingest-corpus.mjs + scripts/rag-build-inbox.mjs consume.
//
// Identity resolution (documented in corpus/SOURCES.json + README):
//   - The wiped 2026-09-07 upload was labeled "Civil transactions law 25/1980".
//     No Kuwaiti law "25/1980" exists — Kuwait's Civil Code is المرسوم بالقانون
//     رقم 67 لسنة 1980 بإصدار القانون المدني (verified: 1082/1082 articles,
//     none missing). Ingested under its TRUE lawId 67/1980 (never guessed).
//   - The wiped upload's "Rental 51/1996" is likewise a mislabel: Kuwait Law
//     51/1996 is the Personal Status Law (the LKB already holds 14 fixture
//     summary rows for it). The rental law is المرسوم بالقانون رقم 35 لسنة
//     1978 في شأن إيجار العقارات — 29 articles (1–29), complete as issued.
//
// Honesty rules (do not "improve" them away):
//   - verified_official stays FALSE (mirror-class, one step from the gazette).
//   - Article text is verbatim from the mirror — no cleanup of substance,
//     no amendment-label stripping, no repeal-marker application.
//
// Usage: node scripts/build-corpus-reattach.mjs [--check]
//   --check: only verify the snapshots still parse to the expected counts.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CHECK = process.argv.includes('--check');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- generic almohami parser: <p>المادة N</p> anchors, verbatim bodies ----
function parseAlmohami(rawJsonPath) {
  const raw = JSON.parse(readFileSync(rawJsonPath, 'utf8'));
  let html = raw.html || '';
  html = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');

  // An anchor line is EXACTLY "المادة N" — in-text references never sit alone
  // on a line, so this cannot split mid-article.
  const lines = text.split('\n').map((l) => l.trim());
  const articles = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^المادة\s+(\d+)$/);
    if (m) {
      if (cur) articles.push(cur);
      cur = { article_number_raw: m[1], text_lines: [] };
    } else if (cur && line) {
      cur.text_lines.push(line);
    }
  }
  if (cur) articles.push(cur);
  return {
    url: raw.url,
    fetchedAt: raw.fetchedAt,
    articles: articles.map((a) => ({ article_number_raw: a.article_number_raw, text_ar: a.text_lines.join('\n').trim() })),
  };
}

// stop capturing body lines at site-footer noise: the first line that equals a
// footer marker terminates the last article's body if a stray anchor was missed
const FOOTER_MARKERS = ['الأسئلة الشائعة', 'المساعدة', 'تحديثات النظام', 'قوانين الكويت', 'سياسة الخصوصية'];

function cleanTail(articles) {
  const last = articles[articles.length - 1];
  if (!last) return articles;
  const keep = [];
  for (const line of last.text_ar.split('\n')) {
    if (FOOTER_MARKERS.some((f) => line.includes(f))) break;
    keep.push(line);
  }
  last.text_ar = keep.join('\n').trim();
  return articles;
}

const SPECS = [
  {
    raw: 'corpus/_raw/almohami-civil-67-1980.json',
    out: 'corpus/KW_CivilCode_67_1980_clean.json',
    file: 'KW_CivilCode_67_1980_clean.json',
    mirrorLawId: 'KW-CIVIL-67-1980',
    lawId: '67/1980',
    lawNameAr: 'المرسوم بالقانون رقم 67 لسنة 1980 بإصدار القانون المدني',
    lawNameEn: 'Kuwait Civil Code (Decree-Law No. 67 of 1980)',
    expectedArticles: 1082,
    quirks: [
      'Identity resolution: the wiped 2026-09-07 upload was labeled "Civil transactions law 25/1980" — no Kuwait law 25/1980 exists; the Kuwaiti Civil Code is Decree 67/1980. Some mirrors style it "مرسوم بقانون" vs "مرسوم بالقانون" — the official gazette identity must be pinned by a lawyer in Phase 0.',
      'Full coverage verified at fetch time: 1082/1082 article headers present, none missing (1..1082).',
      'In-text cross references (e.g. "المادة 101" inside a body) are kept verbatim; extraction anchors only on standalone "المادة N" header lines.',
      'Later amendments (e.g. Decree-Law 4/2025 amending art 441) are NOT consolidated in this mirror snapshot — a lawyer must reconcile against the gazette in Phase 0.',
      'Articles carry numbered paragraph structure ("1 – ...") and continuation lines verbatim.'
    ]
  },
  {
    raw: 'corpus/_raw/almohami-rental-35-1978.json',
    out: 'corpus/KW_Rental_35_1978_clean.json',
    file: 'KW_Rental_35_1978_clean.json',
    mirrorLawId: 'KW-RENT-35-1978',
    lawId: '35/1978',
    lawNameAr: 'المرسوم بالقانون رقم 35 لسنة 1978 في شأن إيجار العقارات',
    lawNameEn: 'Kuwait Rental of Real Estate Law (Decree-Law No. 35 of 1978)',
    expectedArticles: 29,
    quirks: [
      'Identity resolution: the wiped 2026-09-07 upload was labeled "Rental 51/1996" — Kuwait Law 51/1996 is the Personal Status Law (LKB already holds 14 fixture summary rows for it); the rental law is Decree 35/1978.',
      'The mirror carries the original 1978 text, 29 articles (1–29), marked by the source itself as "(1 – 29)" — later amendments are NOT consolidated; Phase 0 lawyer review must reconcile against the current consolidated text.',
      'Cross-checked against kuwaitlawyer.net/law-rents (same 29-article coverage).'
    ]
  }
];

const nowIso = '2026-09-08';
let anyChange = false;

for (const s of SPECS) {
  const parsed = parseAlmohami(s.raw);
  const articles = cleanTail(parsed.articles).map((a) => ({
    article_number_raw: a.article_number_raw,
    text_ar: a.text_ar
  }));

  const nos = articles.map((a) => +a.article_number_raw);
  const dupes = nos.filter((n, i) => nos.indexOf(n) !== i);
  const missing = [];
  if (s.expectedArticles <= 120) { // dense numbering check for small laws
    const set = new Set(nos);
    for (let i = 1; i <= s.expectedArticles; i++) if (!set.has(i)) missing.push(i);
  }
  if (articles.length !== s.expectedArticles || dupes.length || missing.length) {
    console.error(`✘ ${s.file}: expected ${s.expectedArticles} articles, got ${articles.length}` +
      (dupes.length ? `, dupes: ${dupes.join(',')}` : '') +
      (missing.length ? `, missing: ${missing.join(',')}` : ''));
    process.exit(1);
  }
  const tooShort = articles.filter((a) => a.text_ar.length < 5);
  if (tooShort.length) {
    console.error(`✘ ${s.file}: ${tooShort.length} articles with empty/near-empty text: ${tooShort.map(a=>a.article_number_raw).join(',')}`);
    process.exit(1);
  }

  const doc = {
    law_id: s.mirrorLawId,
    law_name_ar: s.lawNameAr,
    law_name_en: s.lawNameEn,
    source_chain: `Fetched from almohami.com law library HTML (${parsed.url}) on ${parsed.fetchedAt}; snapshot pinned at corpus/_raw/`,
    verified_official: false,
    verification_status: 'UNVERIFIED - PENDING LAWYER REVIEW - DO NOT TREAT AS OFFICIAL TEXT',
    note: 'Mirror-class source (one step removed from the gazette). Re-attach of the wiped 2026-09-07 upload, rebuilt from a fresh mirror fetch under the TRUE lawId. See knownQuirks in corpus/SOURCES.json.',
    retrieved_at: nowIso,
    article_count: articles.length,
    articles
  };

  const buf = Buffer.from(JSON.stringify(doc, null, 2), 'utf8');
  if (CHECK) { console.log(`✔ ${s.file}: ${articles.length} articles parse clean`); continue; }
  writeFileSync(s.out, buf);
  anyChange = true;
  console.log(`✔ ${s.file}: ${articles.length} articles -> ${s.out}`);
  console.log(`  sha256: ${sha256(buf)}`);
  console.log(`  mirrorLawId: ${s.mirrorLawId} -> lawId: ${s.lawId}`);
  console.log(`  lawNameAr: ${s.lawNameAr}`);
}

if (CHECK) { console.log('check-only pass — no files written'); process.exit(0); }
if (!anyChange) console.log('nothing written');
