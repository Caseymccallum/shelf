/**
 * Export and import against a real (fake) IndexedDB.
 *
 * The two claims worth testing here are the ones the format documentation makes: that importing the
 * same file twice does not duplicate anything, and that an imported page is findable immediately
 * because the index is rebuilt from its text rather than carried in the file. Both are arithmetic on
 * the index, which is the part of this module that can be wrong without anybody noticing.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  DB_NAME,
  archivePage,
  archiveStats,
  deletePage,
  exportSlice,
  getPage,
  importPages,
  listPages,
  searchPages,
} from './db';
import type { ArchiveEntry } from '../core/export';
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

/** Saves a page whose body text is what the index will be built from. */
async function save(id: string, text: string, overrides: Partial<SavedPage> = {}): Promise<void> {
  await archivePage({ page: page(id, overrides), html: `<p>${text}</p>`, text });
}

/** An entry as a file would carry it. */
function entry(id: string, text: string, overrides: Partial<SavedPage> = {}): ArchiveEntry {
  return { page: page(id, overrides), html: `<p>${text}</p>`, text };
}

async function clearArchive(): Promise<void> {
  const { pages } = await listPages(1000);
  for (const existing of pages) await deletePage(existing.id);
}

/**
 * Removes a page's content and leaves its record, which is a state nothing in the code can produce -
 * a save writes both in one transaction - but which an export has to survive rather than trip over.
 */
async function dropContent(id: string): Promise<void> {
  const opened = indexedDB.open(DB_NAME);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('content', 'readwrite');
    tx.objectStore('content').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('exportSlice', () => {
  beforeEach(clearArchive);

  test('holds the record, the HTML and the text of each page', async () => {
    await save('one', 'the quick brown fox');
    const { entries, total } = await exportSlice(10, 0);

    expect(total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.page.title).toBe('Page one');
    expect(entries[0]?.html).toBe('<p>the quick brown fox</p>');
    expect(entries[0]?.text).toBe('the quick brown fox');
  });

  test('walks the whole archive once, newest first, however small the slices are', async () => {
    await save('one', 'alpha');
    await save('two', 'beta');
    await save('three', 'gamma');

    const walked: string[] = [];
    let offset = 0;
    for (;;) {
      const slice = await exportSlice(2, offset);
      walked.push(...slice.entries.map((item) => item.page.id));
      offset = slice.nextOffset;
      if (offset >= slice.total) break;
    }

    expect(walked).toEqual(['three', 'two', 'one']);
  });

  test('is empty for an empty archive, and says so rather than failing', async () => {
    const slice = await exportSlice(10, 0);
    expect(slice.entries).toEqual([]);
    expect(slice.total).toBe(0);
    expect(slice.nextOffset).toBe(0);
  });

  test('leaves out a page whose content is missing, and still walks every row', async () => {
    await save('one', 'alpha');
    await save('two', 'beta');
    await save('three', 'gamma');
    await dropContent('three');

    // The newest row has nothing to write into a file, so it yields no entry at all...
    const first = await exportSlice(1, 0);
    expect(first.entries).toEqual([]);
    // ...and the offset still advances past it, because a caller that saw the same offset twice would
    // ask for the same slice forever.
    expect(first.nextOffset).toBe(1);

    const second = await exportSlice(1, first.nextOffset);
    expect(second.entries.map((item) => item.page.id)).toEqual(['two']);
    expect(second.nextOffset).toBe(2);
    expect(second.total).toBe(3);
  });
});

describe('importPages', () => {
  beforeEach(clearArchive);

  test('writes an entry and makes it findable at once, with no index in the file', async () => {
    const counts = await importPages([entry('one', 'the marginalia of a durable reader')]);

    expect(counts).toEqual({ added: 1, skipped: 0 });
    const { hits } = await searchPages('marginalia');
    expect(hits.map((hit) => hit.page.id)).toEqual(['one']);
  });

  test('keeps what the file said about the page, including when it was saved', async () => {
    await importPages([
      entry('one', 'alpha', { savedAt: 1_500_000_000_000, warnings: ['an embedded frame was skipped'] }),
    ]);

    const stored = await getPage('one');
    expect(stored?.savedAt).toBe(1_500_000_000_000);
    expect(stored?.warnings).toEqual(['an embedded frame was skipped']);
    expect(stored?.formatVersion).toBe(1);
  });

  test('importing the same file twice adds nothing the second time', async () => {
    const file = [entry('one', 'alpha'), entry('two', 'beta')];

    const first = await importPages(file);
    const second = await importPages(file);

    expect(first).toEqual({ added: 2, skipped: 0 });
    expect(second).toEqual({ added: 0, skipped: 2 });
    expect((await archiveStats()).count).toBe(2);
  });

  test('an export followed by an import restores the same records under the same ids', async () => {
    await save('one', 'alpha beta gamma');
    await save('two', 'delta epsilon');
    const before = await exportSlice(10, 0);

    await clearArchive();
    expect((await archiveStats()).count).toBe(0);

    await importPages(before.entries);
    const after = await exportSlice(10, 0);

    expect(after.entries).toEqual(before.entries);
    // And the rebuilt index answers the same query, which is the part a file cannot carry.
    const { hits } = await searchPages('epsilon');
    expect(hits.map((hit) => hit.page.id)).toEqual(['two']);
  });

  test('reports nothing added for a file that has nothing in it', async () => {
    await save('one', 'alpha');
    expect(await importPages([])).toEqual({ added: 0, skipped: 0 });
    expect((await archiveStats()).count).toBe(1);
  });
});
