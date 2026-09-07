// Local-only embeddings (RAG_SPEC §3.1/§5.3): bge-m3 served by Ollama
// (dev/CPU fallback) or any OpenAI-compatible /embeddings endpoint. ALL
// inference stays inside the deployment — there is no external embedding
// API path in this module by design, and no text is ever logged.
//
// Graceful degradation is a feature, not a fallback hack: when the embed
// service is unreachable (RAG_OLLAMA_HOST unset, model not pulled, service
// down) the pipeline stores `embedding = null` and retrieval runs
// lexical-only (BM25 over the arabic.ts tokenization). `embedMode` in every
// response tells the consumer which path served it.

const HOST = () => (process.env.RAG_OLLAMA_HOST || '').replace(/\/+$/, '');
const MODEL = () => process.env.RAG_EMBED_MODEL || 'bge-m3';
export const EMBED_DIM = Number(process.env.RAG_EMBED_DIM || 1024);

export const embedConfigured = () => !!HOST();

async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

/** Embed one text. Returns number[] | null (null = service unavailable). */
export async function embedOne(text) {
  if (!embedConfigured() || !text) return null;
  // Ollama native endpoint first (/api/embeddings), then OpenAI-compatible.
  try {
    const r = await fetchWithTimeout(`${HOST()}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), prompt: text.slice(0, 8000) })
    });
    if (r.ok) {
      const j = await r.json();
      const v = j.embedding || j.data?.[0]?.embedding;
      if (Array.isArray(v) && v.length) return v;
    }
  } catch { /* fall through */ }
  try {
    const r = await fetchWithTimeout(`${HOST()}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), input: text.slice(0, 8000) })
    });
    if (r.ok) {
      const j = await r.json();
      const v = j.data?.[0]?.embedding;
      if (Array.isArray(v) && v.length) return v;
    }
  } catch { /* unavailable */ }
  return null;
}

/** Batch embed with bounded concurrency. Nulls mark unavailable slots. */
export async function embedBatch(texts, concurrency = 4) {
  const out = new Array(texts.length).fill(null);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, texts.length || 1) }, async () => {
    while (i < texts.length) {
      const idx = i++;
      out[idx] = await embedOne(texts[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

// Reciprocal-rank fusion (spec §4.2, k=60): fuses the lexical and dense
// rankings into one ordering without score-scale assumptions.
export function rrfFuse(rankedListA, rankedListB, k = 60) {
  const scores = new Map();
  const add = (list, weight) => list.forEach((id, rank) => {
    scores.set(id, (scores.get(id) || 0) + weight / (k + rank + 1));
  });
  add(rankedListA, 1);
  add(rankedListB, 1);
  return [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id, score]) => ({ id, score }));
}
