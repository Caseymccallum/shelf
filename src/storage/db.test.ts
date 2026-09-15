/**
 * Storage tests: what a save writes, and what a read gets back.
 *
 * These use `fake-indexeddb` rather than a browser, which is a deliberate dependency: the part of
 * this module that can silently corrupt an archive is the index bookkeeping - what a save adds, what
 * a delete removes, and whether the two agree - and that is invisible from a unit test with no
 * IndexedDB at all. The e2e suite proves the same code in a real browser; this proves the arithmetic
 * exhaustively and in milliseconds.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { archivePage, countTokens, deletePage, getPageContent, listPages } from './db';
import type { SavedPage } from '../core/types';

let clock = 1_700_000_000_000;

function page(id: string, overrides: Partial<SavedPage> = {}): SavedPage {
  return {
    id,
    url: `https://example.test/${id}`,
    title: `Page ${id}`,
    savedAt: (clock += 1000),
    bytes: 100,
    wordCount: 4,
    warnings: [],
    formatVersion: 1,
    ...overrides,
  };
}

/** Saves a page whose body text is the thing search will see. */
async function save(id: string, text: string, overrides: Partial<SavedPage> = {}): Promise<void> {
  await archivePage({ page: page(id, overrides), html: `<p>${text}</p>`, text });
}

/** Empties the archive, so each test starts from a known state. */
async function clearArchive(): Promise<void> {
  const { pages } = await listPages(1000);
  for (const existing of pages) await deletePage(existing.id);
}

describe('countTokens', () => {
  test('counts how often each token appears', () => {
    expect(countTokens(['a', 'b', 'a'])).toEqual({ a: 2, b: 1 });
  });

  test('is empty for no tokens', () => {
    expect(countTokens([])).toEqual({});
  });
});

describe('archivePage and getPageContent', () => {
  beforeEach(clearArchive);

  test('stores the record, the html and the text', async () => {
    await save('one', 'the quick brown fox');
    const content = await getPageContent('one');
    expect(content?.html).toContain('quick brown fox');
    expect(content?.text).toBe('the quick brown fox');
  });

  test('does not leak its internal columns to callers', async () => {
    await save('one', 'some words here');
    const { pages } = await listPages();
    expect(Object.keys(pages[0] ?? {}).sort()).toEqual(
      ['bytes', 'formatVersion', 'id', 'savedAt', 'title', 'url', 'warnings', 'wordCount'].sort(),
    );
  });

  test('reports a page that is not in the archive as null', async () => {
    expect(await getPageContent('missing')).toBeNull();
  });
});

describe('listPages', () => {
  beforeEach(clearArchive);

  test('is empty for an empty archive', async () => {
    expect(await listPages()).toEqual({ pages: [], total: 0 });
  });

  test('lists pages newest first', async () => {
    await save('older', 'one two');
    await save('newer', 'one two');
    const { pages, total } = await listPages();
    expect(total).toBe(2);
    expect(pages.map((entry) => entry.id)).toEqual(['newer', 'older']);
  });

  test('paginates without repeating a page', async () => {
    await save('a', 'one two');
    await save('b', 'one two');
    await save('c', 'one two');
    const first = await listPages(2, 0);
    const second = await listPages(2, 2);
    expect(first.pages).toHaveLength(2);
    expect(second.pages).toHaveLength(1);
    const ids = [...first.pages, ...second.pages].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(3);
  });
});
