// Article-anchored chunking (docs/RAG_SPEC.md §2.4, chunk.schema.json).
// One chunk = one article (or article-paragraph when an article exceeds
// RAG_MAX_CHUNK_CHARS — articlePart sequence on paragraph boundaries).
//
// The pipeline consumes operator-attested source TEXT (var/rag/inbox), never
// the dev seed JSONs (C-R2) and never runs scraping. sourceType "txt" only:
// OCR/scanned-PDF support is explicitly deferred (IMPLEMENTATION_STATUS.md).

import { createHash } from 'node:crypto';
import { normalizeAr, tokenize } from '../arabic.mjs';

export const DEFAULT_MAX_CHARS = Number(process.env.RAG_MAX_CHUNK_CHARS || 1200);

// Anchor: "المادة ١٧" / "مادة (163)" / "المادة 257-260" / "المادة 135 مكرر"
// Line-anchored first; falls back to inline scan only when zero line anchors.
const ANCHOR_LINE =
  /^\s*(?:المادة|مادة)\s*\(?([٠-٩0-9]+)(?:\s*(?:مكرر|مكررة)[^\s،,]*)?(?:\s*[–—-]\s*([٠-٩0-9]+))?\s*\)?\s*[:：.\-–—]?\s*$/;
const ANCHOR_INLINE =
  /(?:المادة|مادة)\s*\(?([٠-٩0-9]+)(?:\s*(?:مكرر|مكررة)[^\s،,]*)?(?:\s*[–—-]\s*([٠-٩0-9]+))?\s*\)?/g;
const CHAPTER_LINE = /^\s*(الباب|الفصل|أبواب|فصول)\b[^\n]{0,120}$/;
const arabicDigit = (s) => String(s).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

// Amendment formulas (spec §2.4 table) — recorded as ProvisionAmendment
// proposals, NEVER auto-applied (lawyer-gated via kb/audit semantics).
const AMENDMENT_PATTERNS = [
  { action: 'REPLACE', re: /يُستبدل|تُستبدل/ },
  { action: 'INSERT', re: /يُضاف|تُضاف/ },
  { action: 'REPEAL', re: /تُلغى|يُلغى|تلغى|يلغى/ },
  { action: 'RESTATE', re: /يُعدَّل|يعدل المادة|لتصبح على النحو الآتي/ },
  { action: 'RENUMBER', re: /يُنقل|يُدمج|يُعاد ترقيم/ },
  { action: 'GENERAL_REPEAL', re: /تُلغى أحكام كل نص يخالف/ }
];

export function detectAmendmentAction(text) {
  for (const p of AMENDMENT_PATTERNS) if (p.re.test(text)) return p.action;
  return null;
}

export const textHash = (lawId, articleNo, articlePart, textNormalized) =>
  createHash('sha256').update(`${lawId}|${articleNo}|${articlePart}|${textNormalized}`).digest('hex');

function splitLongText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  // split on blank lines first, then on sentence terminators, packing parts
  const paras = text.split(/\n{2,}/).flatMap(p => {
    if (p.length <= maxChars) return [p];
    const sentences = p.split(/(?<=[.؟!؛])\s+/);
    const out = [];
    let cur = '';
    for (const s of sentences) {
      if ((cur + ' ' + s).trim().length > maxChars && cur) { out.push(cur.trim()); cur = s; }
      else cur = (cur + ' ' + s).trim();
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  });
  // pack paragraphs into <= maxChars parts
  const parts = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > maxChars && cur) { parts.push(cur.trim()); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.length ? parts : [text.slice(0, maxChars)];
}

/**
 * Chunk a law's source text.
 * @returns {{ chunks: object[], stats: { anchors: number, anchorSource: string, parts: number, chapters: number } }}
 */
export function chunkLawText({ lawId, text, maxChars = DEFAULT_MAX_CHARS, gazetteRef = {} }) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; // { articleNo, chapterHeading, bodyLines[] }
  let current = null;
  let chapter = null;
  let lineAnchors = 0;

  for (const raw of lines) {
    const m = raw.match(ANCHOR_LINE);
    if (m) {
      lineAnchors++;
      if (current && current.bodyLines.join('').trim()) blocks.push(current);
      const base = arabicDigit(m[1]);
      const no = m[0].match(/مكرر/) ? `${base} مكرر` : base;
      current = { articleNo: no, chapterHeading: chapter, bodyLines: [] };
      continue;
    }
    if (CHAPTER_LINE.test(raw)) { chapter = raw.trim(); continue; }
    if (current) current.bodyLines.push(raw);
  }
  if (current && current.bodyLines.join('').trim()) blocks.push(current);

  let anchorSource = 'line';
  if (lineAnchors === 0) {
    // Inline fallback: anchors embedded in flowing text (mirror dialects).
    const joined = String(text ?? '');
    ANCHOR_INLINE.lastIndex = 0;
    const hits = [...joined.matchAll(ANCHOR_INLINE)];
    if (!hits.length) return { chunks: [], stats: { anchors: 0, anchorSource: 'none', parts: 0, chapters: 0 } };
    anchorSource = 'inline';
    for (let i = 0; i < hits.length; i++) {
      const start = hits[i].index + hits[i][0].length;
      const end = i + 1 < hits.length ? hits[i + 1].index : joined.length;
      const base = arabicDigit(hits[i][1]);
      const no = hits[i][0].includes('مكرر') ? `${base} مكرر` : base;
      blocks.push({ articleNo: no, chapterHeading: null, bodyLines: [joined.slice(start, end)] });
    }
  }

  const chunks = [];
  let parts = 0;
  for (const b of blocks) {
    const body = b.bodyLines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (body.length < 5) continue; // anchor-only debris
    const pieces = splitLongText(body, maxChars);
    pieces.forEach((piece, i) => {
      parts++;
      const textCanonical = piece;
      const textNormalized = normalizeAr(textCanonical);
      chunks.push({
        lawId,
        articleNo: b.articleNo,
        articlePart: i + 1,
        chapterHeading: b.chapterHeading,
        amendmentVersion: 'original',
        textCanonical,
        textNormalized,
        textHash: textHash(lawId, b.articleNo, i + 1, textNormalized),
        tokens: tokenize(textCanonical),
        gazetteIssue: gazetteRef.issueNo ?? null,
        gazetteDate: gazetteRef.publishDate ?? null
      });
    });
  }

  return {
    chunks,
    stats: { anchors: lineAnchors || blocks.length, anchorSource, parts, chapters: new Set(blocks.map(b => b.chapterHeading).filter(Boolean)).size }
  };
}
