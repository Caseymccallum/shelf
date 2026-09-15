import { describe, expect, test } from 'vitest';
import { matchesPhrases, rank, snippetFor, type Postings } from './search';
import { parseQuery } from './tokens';

/**
 * A tiny corpus with deliberate properties: `both` contains every term, `rare` contains a term no
 * other page has, `long` contains the same term as `short` but padded with filler, and `apart`
 * contains a phrase's words without the phrase.
 */
const postings: Postings = {
  reader: { both: 3, short: 2, long: 2 },
  privacy: { both: 2, rare: 1 },
  filler: { long: 40 },
  state: { apart: 1 },
  art: { apart: 1 },
};
const lengths = { both: 5, rare: 3, short: 2, long: 45, apart: 4 };
const documentCount = 5;

describe('rank', () => {
  test('returns nothing for a query with no indexable terms', () => {
    expect(rank(parseQuery('the and of'), postings, lengths, documentCount)).toEqual([]);
  });

  test('requires every term to be present', () => {
    // `privacy` is in `both` and `rare`; `reader` is not in `rare`, so `rare` cannot match both words.
    const hits = rank(parseQuery('reader privacy'), postings, lengths, documentCount);
    expect(hits.map((hit) => hit.docId)).toEqual(['both']);
    expect(hits[0]?.matched).toEqual(['reader', 'privacy']);
  });

  test('scores a term that appears everywhere lower than a rare one', () => {
    // Same document, same frequency, same length: the only difference is how many of the five
    // documents contain the term, so the gap between these two scores is the inverse document
    // frequency and nothing else. (Comparing two *different* documents would prove nothing - their
    // frequencies and lengths differ, and those dominate.)
    const withUbiquitous: Postings = {
      ...postings,
      ubiquitous: { rare: 1, both: 1, short: 1, long: 1, apart: 1 },
    };
    const rareTerm = rank(parseQuery('privacy'), withUbiquitous, lengths, documentCount).find(
      (hit) => hit.docId === 'rare',
    );
    const everywhere = rank(parseQuery('ubiquitous'), withUbiquitous, lengths, documentCount).find(
      (hit) => hit.docId === 'rare',
    );
    expect(rareTerm?.score ?? 0).toBeGreaterThan(everywhere?.score ?? 0);
    expect(everywhere?.score ?? 0).toBeGreaterThan(0);
  });

  test('prefers the shorter document when the term frequency is the same', () => {
    const hits = rank(parseQuery('reader'), postings, lengths, documentCount);
    const short = hits.find((hit) => hit.docId === 'short');
    const long = hits.find((hit) => hit.docId === 'long');
    expect(short?.score).toBeGreaterThan(long?.score ?? 0);
  });

  test('is ordered by score, and stable for equal scores', () => {
    const hits = rank(parseQuery('reader'), postings, lengths, documentCount);
    const scores = hits.map((hit) => hit.score);
    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });

  test('returns nothing when no document contains the term', () => {
    expect(rank(parseQuery('nonexistent'), postings, lengths, documentCount)).toEqual([]);
  });

  test('treats a missing length as zero rather than crashing', () => {
    const hits = rank(parseQuery('privacy'), postings, {}, documentCount);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('matchesPhrases', () => {
  const text = 'The state of the art reader is not the same as the state art of the reader.';

  test('is true only when the words are adjacent and in order', () => {
    expect(matchesPhrases(text, [['state', 'of', 'the', 'art']])).toBe(true);
    // The same two words reversed: order is part of what was asked for, not a hint.
    expect(matchesPhrases(text, [['art', 'state']])).toBe(false);
    // Both words present, with others between them, is not the phrase.
    expect(matchesPhrases('the state of modern art', [['state', 'art']])).toBe(false);
  });

  test('requires every phrase', () => {
    expect(matchesPhrases(text, [['state', 'of'], ['reader']])).toBe(true);
    expect(matchesPhrases(text, [['state', 'of'], ['entirely', 'absent']])).toBe(false);
  });

  test('is true when there are no phrases to check', () => {
    expect(matchesPhrases(text, [])).toBe(true);
  });

  test('matches a phrase at the very end of the text', () => {
    expect(matchesPhrases('ends with the reader', [['the', 'reader']])).toBe(true);
  });
});

describe('snippetFor', () => {
  test('prefers the line containing a needle', () => {
    const text = 'First line about nothing.\nSecond line about privacy.\nThird.';
    expect(snippetFor(text, ['privacy'])).toBe('Second line about privacy.');
  });

  test('falls back to the first line when nothing matches', () => {
    expect(snippetFor('Only line here.', ['absent'])).toBe('Only line here.');
  });

  test('centres a long line on the needle and marks both cuts', () => {
    const line = `${'x'.repeat(400)} privacy ${'y'.repeat(400)}`;
    const snippet = snippetFor(line, ['privacy'], 100);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('privacy');
    expect(snippet.length).toBeLessThanOrEqual(102);
  });

  test('does not add an ellipsis when the line was already short enough', () => {
    expect(snippetFor('short line', ['short'], 100)).toBe('short line');
  });

  test('returns nothing for empty text', () => {
    expect(snippetFor('', ['anything'])).toBe('');
  });
});
