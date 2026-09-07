// Arabic text processing + BM25 retrieval — canonical implementation.
//
// This is the SINGLE source of truth for normalization/tokenization/BM25.
// It is plain ESM so BOTH the Next.js server (via the typed re-export in
// arabic.ts) and standalone Node CLIs (scripts/rag-ingest.mjs → RAG pipeline)
// execute byte-identical code paths. Two implementations would drift; the
// RAG spec's RAG-18 parity gate depends on this file being the only one.
//
// History (v2.1): the original tokenizer failed to match bare query words
// against definite forms ("تزوير" vs "التزوير") because the definite article
// "ال" was never stripped and no light stemming existed. This module adds:
//   1. definite-article stripping (ال) when a stem of >= 3 chars remains
//   2. conjunction "و" stripping after article removal
//   3. a conservative suffix stemmer (ات/ون/ين/ان/ه/ة/ي/ك/ها/هم/كم/نا)
//   4. Arabic-Indic digit folding ٠-٩ -> 0-9
// Normalization stays idempotent on both index and query sides.

const TASHKEEL = /[\u064B-\u0652\u0670\u0640]/g; // harakat + dagger alif + tatweel

export function normalizeAr(s = '') {
  return String(s)
    .replace(TASHKEEL, '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

// conservative light stem
export function stemAr(t) {
  let w = t;
  // definite article: ال + stem (>= 3 remaining)
  if (w.startsWith('ال') && w.length >= 5) w = w.slice(2);
  // conjunction prefix: و + stem (>= 3 remaining)
  if (w.startsWith('و') && w.length >= 4) w = w.slice(1);
  const suffixes = ['اتها', 'اتهما', 'اتهم', 'كم', 'هن', 'هم', 'نا', 'ها', 'ات', 'ون', 'ين', 'ان', 'ه', 'ي', 'ك'];
  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

export const STOPWORDS = new Set(
  ('في من على الى إلى عن هذا هذه ذلك تلك التي الذي الذين اللواتي مع قد لا لم لن ما هو هي هم ان أن إن كما بين حيث كل بعض بعد قبل عند لدى غير سوي ثم أو او و يوجد كان كانت يكون تكون له لها لهم به بها بهم اي أي ماذا كيف متى اين أين هناك هنالك ايضا أيضا كذلك حتى إذا اذا لو اما أما إلا الا منذ ذو ذات لدن دون بدون عبر خلال ضمن نحو مثل نفس عام عامة يعني').split(/\s+/)
);

export function tokenize(s = '') {
  return normalizeAr(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
    .map(stemAr)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// ---------- BM25 ----------

export function buildIndex(docs, textField) {
  const withTokens = docs.map(d => ({ ...d, tokens: tokenize(textField(d)) }));
  const N = withTokens.length;
  const avgdl = withTokens.reduce((s, d) => s + d.tokens.length, 0) / N || 1;
  const df = new Map();
  for (const d of withTokens) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  return { docs: withTokens, df, avgdl, N };
}

export function bm25Score(queryTokens, docTokens, df, N, avgdl) {
  const k1 = 1.5, b = 0.75;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const f = tf.get(q) || 0;
    if (!f) continue;
    const dfq = df.get(q) || 0;
    const idf = Math.log(1 + (N - dfq + 0.5) / (dfq + 0.5));
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (docTokens.length / avgdl)));
  }
  return score;
}
