/**
 * The reader: what a saved page does when it is opened, years later, by someone who expects a copy.
 *
 * The claims here are different in kind, and each is tested the way it can actually be tested.
 * "Nothing is fetched to show you this page" is a claim about the network, so the fixture server
 * counts - nobody else can tell the difference between a request that was blocked and one that was
 * never made. "Code in a saved page cannot run" is a claim about a browser, and the fixture's live page
 * is the control: it set its canary in front of us at capture time, so the archive's lack of one is
 * evidence rather than a tautology.
 *
 * The delete test is last, because it is the end of the story: an archive can be thrown away.
 */

import { expect, test, type Page } from '@playwright/test';
import { FIXTURE } from './fixtures';
import { launchShelf, type Shelf } from './harness';

let shelf: Shelf;
let savedId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  shelf = await launchShelf();
  await shelf.openArticle();
  const outcome = await shelf.saveActiveTab();
  if (outcome.status === 'failed') throw new Error(`the save failed: ${outcome.reason}`);
  savedId = outcome.page.id;
});

test.afterAll(async () => {
  await shelf.close();
});

/**
 * Opens one saved page in the reader, and records every request that leaves the extension.
 *
 * A saved page's own contents are inline, so anything that is not the reader's own document is the
 * thing these tests exist to catch.
 */
async function openReader(id: string): Promise<{ reader: Page; external: string[] }> {
  const reader = await shelf.context.newPage();
  const external: string[] = [];
  reader.on('request', (request) => {
    const url = request.url();
    if (!/^(chrome-extension|data|about|blob):/.test(url)) external.push(url);
  });

  await reader.goto(shelf.extensionUrl(`viewer.html?id=${encodeURIComponent(id)}`));
  await expect(reader.locator('#title')).toHaveText(FIXTURE.title);
  return { reader, external };
}

test('opens a saved page and fetches nothing at all to show it', async () => {
  shelf.site.clear();
  const { reader, external } = await openReader(savedId);

  // Not one request to the page's own site, the site of any file it mentioned, or anywhere else.
  expect(shelf.site.hits()).toHaveLength(0);
  expect(external).toHaveLength(0);

  // It really did render the archive: the empty case would also fetch nothing.
  await expect(reader.frameLocator('#frame').locator('h1')).toHaveText(FIXTURE.title);
});

test('counts the files it could not save, and offers to fetch them', async () => {
  const { reader } = await openReader(savedId);
  const srcdoc = await reader
    .locator('#frame')
    .evaluate((element) => (element as HTMLIFrameElement).srcdoc);

  // Counted here by looking for the attributes themselves, which is a different way of arriving at the
  // number the reader states - so the two agreeing means the reader counted the document it is showing.
  const detached = [
    'data-shelf-remote-src=',
    'data-shelf-remote-srcset=',
    'data-shelf-remote-poster=',
    'data-shelf-remote-stylesheet=',
  ].reduce((total, attribute) => total + srcdoc.split(attribute).length - 1, 0);

  expect(detached).toBeGreaterThan(0);
  await expect(reader.locator('#notes')).toContainText(`${detached} files were not saved locally`);
  await expect(reader.getByRole('button', { name: 'Load them from the network' })).toBeVisible();
});

test('the page it shows cannot run code, and cannot navigate away', async () => {
  const { reader } = await openReader(savedId);
  const frame = reader.frameLocator('#frame');

  await expect(frame.locator('script')).toHaveCount(0);
  await expect(frame.locator('[onclick]')).toHaveCount(0);
  await expect(frame.locator('[href^="javascript:"]')).toHaveCount(0);

  // The reader adds a policy of its own, and removes the one thing a policy cannot stop: a document
  // navigating itself. `refresh` is in the fixture, so its absence here is the reader's doing.
  const srcdoc = await reader
    .locator('#frame')
    .evaluate((element) => (element as HTMLIFrameElement).srcdoc);
  expect(srcdoc).toContain("default-src 'none'");
  expect(srcdoc).toContain('form-action');
  expect(srcdoc).not.toMatch(/http-equiv="refresh"/i);
});

test('fetches the missing files only when the reader asks, and only those files', async () => {
  const { reader } = await openReader(savedId);
  shelf.site.clear();

  await reader.getByRole('button', { name: 'Load them from the network' }).click();
  await expect(reader.locator('#notes')).toContainText('this page told other sites you opened it');
  await expect.poll(() => shelf.site.hitsFromOtherOrigin().length).toBeGreaterThan(0);

  // Only files that existed as references in the page, and the tracker is among them: that is the cost
  // the reader named before it acted.
  const paths = shelf.site.otherOriginPaths();
  const allowed = ['/track.gif', '/hero-2x.png', '/remote.css', '/poster.jpg', '/clip.mp4', '/remote-art.png'];
  expect(paths.filter((path) => !allowed.includes(path))).toEqual([]);
  expect(paths).toContain('/track.gif');

  // Asking for files is not the same as asking for a page: the frame's own document, the preload, the
  // redirect and the form target are all still nothing but records.
  expect(shelf.site.hitsFor('/frame')).toHaveLength(0);
  expect(shelf.site.hitsFor('/preload.js')).toHaveLength(0);
  expect(shelf.site.hitsFor('/redirected')).toHaveLength(0);
  expect(shelf.site.hitsFor('/post')).toHaveLength(0);

  // And the offer is not made twice.
  await expect(reader.getByRole('button', { name: 'Load them from the network' })).toHaveCount(0);
});

test('opens a link in a new tab, so the archive is not replaced by the live page', async () => {
  const { reader } = await openReader(savedId);
  shelf.site.clear();

  const [opened] = await Promise.all([
    shelf.context.waitForEvent('page'),
    reader.frameLocator('#frame').getByRole('link', { name: 'the next page' }).click(),
  ]);
  await opened.waitForLoadState('domcontentloaded');

  expect(opened.url()).toBe(`${shelf.site.origin}/next`);
  // The reader is still showing the copy, and the network was reached only because a person clicked.
  expect(reader.url()).toContain('viewer.html?id=');
  await expect(reader.locator('#title')).toHaveText(FIXTURE.title);
  expect(shelf.site.hitsFor('/next')).toHaveLength(1);

  await opened.close();
});

test('deletes in two steps, and the second one says what it will do', async () => {
  const { reader } = await openReader(savedId);

  await reader.locator('#delete').click();
  await expect(reader.locator('#delete')).toHaveText('Yes, delete it');
  // One click changed nothing: the page is still in the archive.
  expect((await shelf.stats()).count).toBe(1);

  await reader.locator('#delete').click();
  // The reader sends the person back to the library, which is a library with nothing in it again.
  await expect(reader).toHaveURL(/library\.html/);
  await expect(reader.locator('#results')).toContainText('Nothing saved yet');
  expect((await shelf.stats()).count).toBe(0);
  expect((await shelf.stored(savedId)).page).toBeNull();
});
