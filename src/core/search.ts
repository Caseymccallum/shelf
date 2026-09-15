/**
 * Ranking saved pages against a query.
 *
 * BM25, because it is the smallest ranking function that behaves like people expect: a term that
 * appears in every document is worth less than a rare one, a term appearing five times in a short
 * page beats the same five times in a long one, and the result is a number that can be explained to
 * a user ("this matched both words, twice, in a short page") rather than a vibe.
 *
 * Everything here is pure and takes plain objects, because the same code runs in a unit test, in
 * the service worker, and in the library page - and because the index lives in IndexedDB, so it is
 * serialisable by construction.
 */

import { indexableTokens, tokenizeAll, type ParsedQuery } from './tokens';

/** BM25's term-frequency saturation and length-normalisation constants: the standard defaults. */
const K1 = 1.2;
const B = 0.75;

/** Term frequencies: `postings[token][docId]` is how often `token` occurs in that document. */
export type Postings = Record<string, Record<string, number>>;

/** Document lengths in tokens, for length normalisation. */
export type DocLengths = Record<string, number>;

export interface RankedDoc {
  docId: string;
  score: number;
  /** The query terms this document actually contains, in query order. */
  matched: string[];
}

/** Inverse document frequency: rare terms score higher, and a term in every document scores ~0. */
function idf(documentCount: number, documentFrequency: number): number {
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

/**
 * Ranks documents that contain at least one of the query's required tokens.
 *
 * Documents missing any required token are excluded rather than down-ranked: this is a search box,
 * and a user who types two words means both. Ties are broken by id so that equal scores come back
 * in a stable order - an unstable result list is a bug report waiting to happen.
 */
export function rank(
  query: ParsedQuery,
  postings: Postings,
  lengths: DocLengths,
  documentCount: number,
): RankedDoc[] {
  // Only tokens the index can hold are required of it: a stop word inside a phrase is verified
  // against the page's text later, not demanded of an index that never contained it.
  const required = indexableTokens(query);
  if (required.length === 0) return [];

  const candidateIds = new Set<string>();
  for (const token of required) {
    const docs = postings[token];
    if (docs === undefined) continue;
    for (const docId of Object.keys(docs)) candidateIds.add(docId);
  }
  if (candidateIds.size === 0) return [];

  const lengthsOfCandidates = [...candidateIds].map((docId) => lengths[docId] ?? 0);
  const averageLength =
    lengthsOfCandidates.reduce((sum, value) => sum + value, 0) / Math.max(1, lengthsOfCandidates.length);

  const ranked: RankedDoc[] = [];

  for (const docId of candidateIds) {
    const length = lengths[docId] ?? 0;
    let score = 0;
    const matched: string[] = [];

    for (const token of required) {
      const termFrequency = postings[token]?.[docId];
      if (termFrequency === undefined || termFrequency === 0) continue;
      const documentFrequency = Object.keys(postings[token] ?? {}).length;
      const normalisation = K1 * (1 - B + (B * length) / Math.max(1, averageLength));
      score += idf(documentCount, documentFrequency) * ((termFrequency * (K1 + 1)) / (termFrequency + normalisation));
      matched.push(token);
    }

    // Every required word has to be present, or this is not a match for what was asked.
    if (matched.length < required.length) continue;
    ranked.push({ docId, score, matched });
  }

  ranked.sort((left, right) => right.score - left.score || left.docId.localeCompare(right.docId));
  return ranked;
}

/**
 * True when `text` contains every phrase as consecutive tokens.
 *
 * Phrases are verified against the text rather than the index: an index of single words cannot
 * prove that "state of the art" appeared in that order, and a phrase search that quietly returns
 * documents containing the three words apart is worse than no phrase search. The text is tokenized
 * *with* stop words, because a phrase names them.
 */
export function matchesPhrases(text: string, phrases: readonly (readonly string[])[]): boolean {
  if (phrases.length === 0) return true;
  const tokens = tokenizeAll(text);
  return phrases.every((phrase) => containsSequence(tokens, phrase));
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let index = 0;
    while (index < needle.length && haystack[start + index] === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

/**
 * The line of `text` that best shows why a document matched, trimmed to a readable length.
 *
 * A snippet from the page's own words is the difference between a result list a user trusts and one
 * they have to open to evaluate - and showing the matched line is what makes an offline search
 * feel instant.
 */
export function snippetFor(text: string, needles: readonly string[], maxLength = 180): string {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return '';

  const lowered = needles.map((needle) => needle.toLowerCase()).filter((needle) => needle !== '');
  const line =
    lines.find((candidate) => lowered.some((needle) => candidate.toLowerCase().includes(needle))) ??
    lines[0] ??
    '';

  if (line.length <= maxLength) return line;

  // Centre the snippet on the first needle so the matched words are visible, not cut off.
  const needle = lowered.find((value) => line.toLowerCase().includes(value)) ?? '';
  const at = needle === '' ? 0 : Math.max(0, line.toLowerCase().indexOf(needle) - Math.floor(maxLength / 3));
  const slice = line.slice(at, at + maxLength).trim();
  return `${at > 0 ? '…' : ''}${slice}${at + maxLength < line.length ? '…' : ''}`;
}
