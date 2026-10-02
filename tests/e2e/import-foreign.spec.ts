/**
 * Importing other people's files, driven through the library the way a person would: a file on
 * disk, the Import button, and the same file back in.
 *
 * The unit tests prove the parsers; these prove the promises around them - that a link-only record
 * *says* it is one wherever it is shown, that a foreign file twice is still one archive (identity is
 * derived by the worker from the content, not carried in the file), and that a saved page arrives
 * with nothing executable in it. Those are claims about the real write path and the real reader, so
 * they are worth nothing until a real browser has run them.
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchShelf, type Shelf } from './harness';

let shelf: Shelf;
let files = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  shelf = await launchShelf();
  files = mkdtempSync(join(tmpdir(), 'shelf-import-'));
});

test.afterAll(async () => {
  await shelf.close();
  rmSync(files, { recursive: true, force: true });
});

const POCKET_CSV = [
  'title,url,time_added,tags,status',
  'An article worth keeping,https://pocket.test/a,1726000000,reading|work,unread',
  '"Quoted, with ""quotes""",https://pocket.test/b,1726100000,,archive',
  ',https://pocket.test/c,1726200000,,unread',
  'Row with no address,,,missing,unread',
].join('\n');

const BOOKMARKS = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<DL><p>',
  '  <DT><H3>Work</H3>',
  '  <DL><p>',
  '    <DT><A HREF="https://marks.test/1" ADD_DATE="1726000000">First mark</A>',
  '  </DL><p>',
  '</DL><p>',
].join('\n');

const SAVED_PAGE = [
  '<!doctype html>',
  '<html><head><title>A saved page</title>',
  '<link rel="canonical" href="https://saved.test/page">',
  '</head><body>',
  '<h1>A saved page</h1>',
  '<p>Body words worth finding later.</p>',
  '<script>fetch("https://evil.test")</script>',
  '</body></html>',
].join('\n');

/** Writes a fixture file and returns its path. */
function fixture(name: string, contents: string): string {
  const path = join(files, name);
  writeFileSync(path, contents);
  return path;
}

test('a Pocket export imports as links that say they are links', async () => {
  await shelf.library.locator('#import-file').setInputFiles(fixture('part_000000.csv', POCKET_CSV));

  // The message counts what arrived and says what it is; the row with no address is reported as
  // left out rather than dropped silently.
  await expect(shelf.library.locator('#transfer')).toContainText('Added 3 links');
  await expect(shelf.library.locator('#transfer')).toContainText('Left out 1 link that could not be read');
  await expect(shelf.library.locator('#transfer')).toContainText('the file held addresses, not the pages themselves');

  // Every link-only record wears its warning where a person reads the list.
  const warnings = shelf.library.locator('.results .badge');
  await expect(warnings).toHaveCount(3);
  await expect(warnings.first()).toHaveText('Saved as a link; the page itself was not in that file.');
});

test('imported links are findable by their title and their tags', async () => {
  const byTitle = await shelf.search('article worth keeping');
  expect(byTitle.hits).toHaveLength(1);
  expect(byTitle.hits[0]?.page.url).toBe('https://pocket.test/a');

  const byTag = await shelf.search('reading');
  expect(byTag.hits.map((hit) => hit.page.url)).toContain('https://pocket.test/a');
});

test('importing the same Pocket export again adds nothing, because identity is the content', async () => {
  await shelf.library.locator('#import-file').setInputFiles(join(files, 'part_000000.csv'));

  await expect(shelf.library.locator('#transfer')).toContainText('3 links already in your shelf');
  expect((await shelf.stats()).count).toBe(3);
});

test('a bookmarks file imports with its folders as tags', async () => {
  await shelf.library.locator('#import-file').setInputFiles(fixture('bookmarks.html', BOOKMARKS));

  await expect(shelf.library.locator('#transfer')).toContainText('Added 1 link');
  const found = await shelf.search('First mark');
  expect(found.hits).toHaveLength(1);

  // The folder name is part of what the record indexes, so "that thing in Work" finds it.
  const byFolder = await shelf.search('Work');
  expect(byFolder.hits.map((hit) => hit.page.url)).toContain('https://marks.test/1');
});

test('a saved page arrives as content, with nothing executable in it', async () => {
  await shelf.library.locator('#import-file').setInputFiles(fixture('saved.html', SAVED_PAGE));

  await expect(shelf.library.locator('#transfer')).toContainText('Added 1 page');

  const found = await shelf.search('Body words worth finding later');
  expect(found.hits).toHaveLength(1);

  const id = found.hits[0]?.page.id ?? '';
  const stored = await shelf.stored(id);
  expect(stored.page?.url).toBe('https://saved.test/page');
  // The product's promise, checked on what is actually stored rather than on the parser's opinion:
  // nothing executable survives, even when the file arrived from somewhere Shelf never saw.
  expect(stored.html ?? '').not.toContain('<script');
  expect(stored.html ?? '').toContain('Body words worth finding later.');
});

test('the reader shows a link-only record and says what is missing', async () => {
  const found = await shelf.search('article worth keeping');
  const id = found.hits[0]?.page.id ?? '';

  const reader = await shelf.context.newPage();
  await reader.goto(shelf.extensionUrl(`viewer.html?id=${id}`));
  await expect(reader.locator('#notes')).toContainText('Saved as a link; the page itself was not in that file.');
  await reader.close();
});