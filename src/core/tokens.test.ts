import { describe, expect, test } from 'vitest';
import { parseQuery, requiredTokens, tokenize } from './tokens';

describe('tokenize', () => {
  test('lowercases and splits on punctuation', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });

  test('keeps internal apostrophes and hyphens so words stay whole', () => {
    expect(tokenize("don't state-of-the-art")).toEqual(["don't", 'state-of-the-art']);
  });

  test('drops a trailing possessive apostrophe', () => {
    expect(tokenize("reader's")).toEqual(["reader's"]);
    expect(tokenize('readers’')).toEqual(['readers']);
  });

  test('keeps digits, including on their own, but drops lone letters', () => {
    expect(tokenize('5 reasons a good 2026')).toEqual(['5', 'reasons', 'good', '2026']);
  });

  test('drops stop words', () => {
    expect(tokenize('the state of the art')).toEqual(['state', 'art']);
  });

  test('treats non-Latin scripts as words', () => {
    expect(tokenize('café 日本語')).toEqual(['café', '日本語']);
  });

  test('returns nothing for empty or punctuation-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ---  ')).toEqual([]);
  });
});

describe('parseQuery', () => {
  test('splits words into unique terms', () => {
    expect(parseQuery('reader reader privacy').terms).toEqual(['reader', 'privacy']);
  });

  test('keeps a quoted phrase whole, and keeps stop words inside it', () => {
    const parsed = parseQuery('"the state of the art" privacy');
    expect(parsed.phrases).toEqual([['the', 'state', 'of', 'the', 'art']]);
    expect(parsed.terms).toEqual(['privacy']);
  });

  test('supports several phrases', () => {
    const parsed = parseQuery('"one two" "three four"');
    expect(parsed.phrases).toEqual([
      ['one', 'two'],
      ['three', 'four'],
    ]);
  });

  test('ignores an empty quoted run', () => {
    expect(parseQuery('"" privacy').phrases).toEqual([]);
    expect(parseQuery('"" privacy').terms).toEqual(['privacy']);
  });

  test('flags a query that was nothing but stop words', () => {
    const parsed = parseQuery('the and of');
    expect(parsed.terms).toEqual([]);
    expect(parsed.phrases).toEqual([]);
    expect(parsed.allStopWords).toBe(true);
  });

  test('flags an empty query as empty rather than all-stop-words', () => {
    expect(parseQuery('   ').allStopWords).toBe(false);
  });
});

describe('requiredTokens', () => {
  test('is the union of terms and phrase words, without duplicates', () => {
    const parsed = parseQuery('privacy "privacy matters"');
    expect(requiredTokens(parsed).sort()).toEqual(['matters', 'privacy']);
  });

  test('is empty when the query asks for nothing', () => {
    expect(requiredTokens(parseQuery('the of'))).toEqual([]);
  });
});
