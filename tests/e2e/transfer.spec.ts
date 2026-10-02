/**
 * Export and import, driven through the library the way a person would: a click, a file on disk, and
 * the same file back in.
 *
 * The claims these tests exist for are the ones in `docs/FORMAT.md`, and each needs a real browser to
 * be worth anything. A download is a browser behaviour (a blob, an anchor, a download that Playwright
 * can only see if the browser really performed it). A re-import being idempotent is a claim about
 * identity being the hash of the content, which is only true if the real capture produced the hash.
 * And "the file carries the archive" is checked against what the worker has stored, byte for byte,
 * rather than against a substring that a truncated file might also happen to contain.
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SavedPage } from '../../src/core/types';
import { FIXTURE } from './fixtures';
import { launchShelf, type Shelf } from './harness';

/** The parts of an exported file these tests look at. The same shape `core/export.ts` writes. */
interface ExportedFile {
  kind: string;
  exportFormat: number;
  formatVersion: number;
  exportedAt: number;
  count: number;
  pages: { page: SavedPage; html: string; text: string }[];
}

let shelf: Shelf;
let downloads = '';
let saved = 0;
let articleId = '';
let nextId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  shelf = await launchShelf();
  downloads = mkdtempSync(join(tmpdir(), 'shelf-transfer-'));

  await shelf.openArticle();
  const article = await shelf.saveActiveTab();
  if (article.status === 'failed') throw new Error(`the save failed: ${article.reason}`);
  articleId = article.page.id;

  // A second page, from a different address, so the library holds two records that are not the same
  // content. Saved the way the popup would: the page in front is the page that gets saved.
  const next = await shelf.context.newPage();
  await next.goto(shelf.site.url('/next'), { waitUntil: 'load' });
  const second = await shelf.saveActiveTab({ page: next });
  if (second.status === 'failed') throw new Error(`the second save failed: ${second.reason}`);
  nextId = second.page.id;
});

test.afterAll(async () => {
  await shelf.close();
  rmSync(downloads, { recursive: true, force: true });
});

/**
 * Clicks Export and keeps the file the browser downloaded.
 *
 * Waiting for the download event rather than for a message is deliberate: it is the only way to know
 * that a file left the browser, which is the thing being tested.
 */
async function exportToFile(): Promise<{ name: string; raw: string; file: ExportedFile }> {
  saved += 1;
  const [download] = await Promise.all([
    shelf.library.waitForEvent('download'),
    shelf.library.locator('#export').click(),
  ]);

  const path = join(downloads, `export-${saved}.json`);
  await download.saveAs(path);
  const raw = readFileSync(path, 'utf8');
  return { name: download.suggestedFilename(), raw, file: JSON.parse(raw) as ExportedFile };
}

test('exports the archive to one file that holds the archive, and touches no network', async () => {
  shelf.site.clear();
  const exported = await exportToFile();

  expect(exported.name).toMatch(/^shelf-\d{4}-\d{2}-\d{2}\.json$/);
  expect(exported.file.kind).toBe('shelf-export');
  expect(exported.file.exportFormat).toBe(1);
  expect(exported.file.count).toBe(2);
  expect(exported.file.pages).toHaveLength(2);

  const entry = exported.file.pages.find((candidate) => candidate.page.id === articleId);
  if (entry === undefined) throw new Error('the export did not contain the article that was saved');

  // The record travels with the content, and the content is what the worker has stored - not a
  // summary of it, and not something re-rendered on the way out.
  expect(entry.page.title).toBe(FIXTURE.title);
  expect(entry.page.url).toBe(`${shelf.site.origin}/article`);
  expect(entry.page.id).toHaveLength(32);
  expect(entry.page.formatVersion).toBe(1);
  expect(entry.page.warnings.length).toBeGreaterThan(0);
  expect(entry.html).toBe((await shelf.stored(articleId)).html);
  expect(entry.text).toContain(FIXTURE.bodyWord);

  // The index is not in the file: it is a cache, and an importer rebuilds it from the text.
  expect(exported.raw).not.toContain('"postings"');
  expect(exported.raw).not.toContain('"tokens"');

  // JSON that parses is the proof that the pieces the worker sent added up: the export is assembled
  // from a header and runs of entries in the page, not written by the worker in one message.
  expect(Object.keys(exported.file).sort()).toEqual([
    'count',
    'exportFormat',
    'exportedAt',
    'formatVersion',
    'kind',
    'pages',
  ]);

  await expect(shelf.library.locator('#transfer')).toContainText('Exported 2 pages to shelf-');
  expect((await shelf.stats()).count).toBe(2);

  // Reading an archive does not reach the network, and this is the fixture's own account of it.
  expect(shelf.site.hits()).toHaveLength(0);
});

test('importing the archive it just exported adds nothing, because identity is the content', async () => {
  const exported = await exportToFile();

  await shelf.library.locator('#import-file').setInputFiles(join(downloads, `export-${saved}.json`));

  // The whole promise of content-addressed identity, in one line: the same file twice is one library.
  await expect(shelf.library.locator('#transfer')).toContainText('already in your shelf');
  await expect(shelf.library.locator('#stats')).toHaveText(/^2 pages · /);
  expect((await shelf.stats()).count).toBe(2);
});

test('a page deleted from the library comes back from the file, and is findable again', async () => {
  const exported = await exportToFile();

  // Deleted through the library, two clicks, the way a person would.
  const row = shelf.library.locator('#results li', { hasText: 'The next page' });
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Yes, delete it' }).click();
  await expect(shelf.library.locator('#stats')).toHaveText(/^1 page · /);

  // Gone, including from the index: a word only that page contained no longer finds anything.
  expect((await shelf.stored(nextId)).page).toBeNull();
  expect((await shelf.search('clicked')).hits).toHaveLength(0);

  await shelf.library.locator('#import-file').setInputFiles(join(downloads, `export-${saved}.json`));
  await expect(shelf.library.locator('#transfer')).toContainText('Added 1 page');
  await expect(shelf.library.locator('#stats')).toHaveText(/^2 pages · /);

  // The index was rebuilt from the text in the file, because no file carries one.
  const found = await shelf.search('clicked');
  expect(found.hits.map((hit) => hit.page.id)).toEqual([nextId]);

  // And the archived HTML came back with it, which is the other half of what a page is.
  expect((await shelf.stored(nextId)).html).toContain('fetched by someone who clicked');
  // Its own id again, unchanged: the record was restored rather than remade.
  expect(found.hits[0]?.page.id).toBe(exported.file.pages.find((entry) => entry.page.id === nextId)?.page.id);
});

test('a file whose ids do not match its content is re-keyed from the content', async () => {
  const exported = await exportToFile();
  const entry = exported.file.pages.find((candidate) => candidate.page.id === nextId);
  if (entry === undefined) throw new Error('the export did not contain the second page');

  // Hand-edited the way a person with a text editor might: different content, and an id that is
  // nothing to do with it. What the file claims must not become what the archive believes.
  const claimed = 'f'.repeat(32);
  entry.html = `${entry.html}<p>Edited by hand.</p>`;
  entry.text = `${entry.text} edited`;
  entry.page.id = claimed;
  entry.page.title = 'The next page (edited)';

  const tampered = join(downloads, 'by-hand.json');
  writeFileSync(tampered, JSON.stringify(exported.file), 'utf8');

  await shelf.library.locator('#import-file').setInputFiles(tampered);
  await expect(shelf.library.locator('#transfer')).toContainText('Re-keyed 1 page');
  await expect(shelf.library.locator('#stats')).toHaveText(/^3 pages · /);

  const found = await shelf.search('edited');
  expect(found.hits).toHaveLength(1);
  const stored = found.hits[0]?.page;
  expect(stored?.id).not.toBe(claimed);
  expect(stored?.id).toHaveLength(32);
  // Everything the file was the only source of is kept; only the identity was re-derived.
  expect(stored?.title).toBe('The next page (edited)');
  expect((await shelf.stored(stored?.id ?? '')).html).toContain('Edited by hand.');
});

test('refuses a JSON file that is not a Shelf export, and leaves the archive as it was', async () => {
  const stranger = join(downloads, 'bookmarks.json');
  writeFileSync(stranger, JSON.stringify({ hello: 'world' }), 'utf8');

  await shelf.library.locator('#import-file').setInputFiles(stranger);

  await expect(shelf.library.locator('#transfer')).toHaveText('That JSON file is not a Shelf export.');
  await expect(shelf.library.locator('#stats')).toHaveText(/^3 pages · /);
  expect((await shelf.stats()).count).toBe(3);
});

test('an export of just the picked pages holds just those pages', async () => {
  // Picked through the row's checkbox, the way a reader taking one page with them would.
  const row = shelf.library.locator('#results li.result', { hasText: 'The next page (edited)' });
  await row.getByRole('checkbox').check();
  await expect(shelf.library.locator('#export-selected')).toHaveText('Export selected (1)');

  const [download] = await Promise.all([
    shelf.library.waitForEvent('download'),
    shelf.library.locator('#export-selected').click(),
  ]);
  const path = join(downloads, 'picked.json');
  await download.saveAs(path);
  const picked = JSON.parse(readFileSync(path, 'utf8')) as ExportedFile;

  // The same file shape as an export of everything - the envelope's count and the pages agree that
  // this one holds a single page, and it is the page that was picked.
  expect(picked.kind).toBe('shelf-export');
  expect(picked.exportFormat).toBe(1);
  expect(picked.count).toBe(1);
  expect(picked.pages.map((entry) => entry.page.title)).toEqual(['The next page (edited)']);
  await expect(shelf.library.locator('#transfer')).toContainText('Exported 1 page to');

  // And the pick survives the trip: the row is still picked, so an export can be repeated.
  await expect(row.getByRole('checkbox')).toBeChecked();
});
