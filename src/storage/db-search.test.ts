/**
 * Storage tests: search, deletion and the things that must agree with each other.
 *
 * The interesting failures in an archive are the quiet ones - a deleted page still turning up in a
 * search, an index that drifts from its pages - so these tests assert the *relationship* between the
 * three stores rather than each store on its own.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { archivePage, archiveStats, deletePage, getPageContent, listPages, searchPages } from './db';
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

async function save(id: string, text: string, overrides: Partial<SavedPage> = {}): Promise<void> {
  await archivePage({ page: page(id, overrides), html: `<p>${text}</p>`, text });
}

async function clearArchive(): Promise<void> {
  const { pages } = await listPages(1000);
  for (const existing of pages) await deletePage(existing.id);
}

describe('searchPages', () => {
  beforeEach(clearArchive);

  test('finds a page by a word in its text, and shows the line it matched', async () => {
    await save('one', 'A field guide to migrating geese');
    await save('two', 'Notes on bicycle maintenance');
    const { hits } = await searchPages('geese');
    expect(hits.map((hit) => hit.page.id)).toEqual(['one']);
    expect(hits[0]?.snippet).toContain('geese');
  });

  test('requires every word, not any of them', async () => {
    await save('one', 'migrating geese and other birds');
    await save('two', 'migrating swallows');
    const { hits } = await searchPages('migrating geese');
    expect(hits.map((hit) => hit.page.id)).toEqual(['one']);
  });

  test('matches a quoted phrase only when the words are adjacent and in order', async () => {
    await save('adjacent', 'the state of the art reader');
    await save('apart', 'the state of modern art, and the reader');
    const { hits } = await searchPages('"state of the art"');
    expect(hits.map((hit) => hit.page.id)).toEqual(['adjacent']);
  });

  test('explains a query made only of common words instead of returning everything', async () => {
    await save('one', 'the and of');
    const { hits, note } = await searchPages('the and of');
    expect(hits).toEqual([]);
    expect(note).toContain('common');
  });

  test('says so when nothing in the archive matches', async () => {
    await save('one', 'migrating geese');
    const { hits, note } = await searchPages('submarine');
    expect(hits).toEqual([]);
    expect(note).toContain('Nothing');
  });

  test('ranks the shorter page above the longer one for the same word', async () => {
    await save('short', 'geese', { wordCount: 1 });
    await save('long', `geese ${'filler '.repeat(60)}`, { wordCount: 61 });
    const { hits } = await searchPages('geese');
    expect(hits[0]?.page.id).toBe('short');
  });

  test('finds a word that only appears deep in the text, not just in the title', async () => {
    await save('one', `Introduction\n${'padding '.repeat(50)}\nthe marmalade recipe`);
    const { hits } = await searchPages('marmalade');
    expect(hits.map((hit) => hit.page.id)).toEqual(['one']);
  });
});

describe('deletePage', () => {
  beforeEach(clearArchive);

  test('removes the page, its content and its index entries', async () => {
    await save('one', 'migrating geese');
    expect(await deletePage('one')).toBe(true);
    expect(await getPageContent('one')).toBeNull();
    expect((await searchPages('geese')).hits).toEqual([]);
  });

  test('leaves other pages findable, including for the word they shared', async () => {
    await save('one', 'migrating geese');
    await save('two', 'migrating swallows');
    await deletePage('one');
    const { hits } = await searchPages('migrating');
    expect(hits.map((hit) => hit.page.id)).toEqual(['two']);
  });

  test('reports false for a page that is not there', async () => {
    expect(await deletePage('never-existed')).toBe(false);
  });
});

describe('archiveStats', () => {
  beforeEach(clearArchive);

  test('is empty for an empty archive', async () => {
    expect(await archiveStats()).toEqual({ count: 0, bytes: 0, oldest: null, newest: null });
  });

  test('counts pages and bytes, and spans the oldest to the newest', async () => {
    await save('one', 'one two', { bytes: 10 });
    await save('two', 'one two', { bytes: 25 });
    const stats = await archiveStats();
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBe(35);
    expect(stats.oldest).toBeLessThan(stats.newest ?? 0);
  });
});
