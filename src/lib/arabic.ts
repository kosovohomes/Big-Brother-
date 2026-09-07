// Arabic text processing + BM25 retrieval — typed facade.
//
// The implementation lives in arabic.mjs (canonical, shared with the RAG
// ingestion CLI so index-side and pipeline-side normalization can never
// drift — RAG_SPEC RAG-18). This file keeps the public typed surface that
// the TS server compiles against. Do not add logic here.

import {
  normalizeAr as _normalizeAr,
  stemAr as _stemAr,
  tokenize as _tokenize,
  buildIndex as _buildIndex,
  bm25Score as _bm25Score,
  STOPWORDS as _STOPWORDS
} from './arabic.mjs';

export const normalizeAr: (s?: string) => string = _normalizeAr;
export const stemAr: (t: string) => string = _stemAr;
export const tokenize: (s?: string) => string[] = _tokenize;
export const STOPWORDS: Set<string> = _STOPWORDS;

export interface IndexedDoc {
  id: string;
  tokens: string[];
  [k: string]: unknown;
}

export function buildIndex<T extends Record<string, unknown>>(
  docs: T[],
  textField: (d: T) => string
): { docs: (T & { tokens: string[] })[]; df: Map<string, number>; avgdl: number; N: number } {
  return _buildIndex(docs, textField) as { docs: (T & { tokens: string[] })[]; df: Map<string, number>; avgdl: number; N: number };
}

export function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  df: Map<string, number>,
  N: number,
  avgdl: number
): number {
  return _bm25Score(queryTokens, docTokens, df, N, avgdl);
}
