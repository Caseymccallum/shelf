/**
 * The capture, end to end, in the browser that will actually run it.
 *
 * These tests are ordered because they are one story: a page is read, archived, found again, and not
 * saved twice. Each one states a promise the product makes to a person, and each was written after
 * reading the fixture, not after reading the code.
 *
 * The fixture server counts every request it answers, which is what lets "nothing was fetched from
 * another site" be a measurement. Before the save, the test checks that the *live page* really did
 * fetch the other origin - without that, the measurement afterwards would only prove the fixture was
 * inert.
 */

import { expect, test } from '@playwright/test';
import type { SavedPage } from '../../src/core/types';
import type { SaveOutcome } from '../../src/shared/protocol';
import { CANVAS, FIXTURE } from './fixtures';
import { launchShelf, type Shelf } from './harness';

let shelf: Shelf;
let articleUrl = '';
let saved: SavedPage;

/** The page a save produced, or a failure that says why there is none. */
function pageFrom(outcome: SaveOutcome): SavedPage {
  if (outcome.status === 'failed') throw new Error(`the save failed: ${outcome.reason}`);
  return outcome.page;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  shelf = await launchShelf();
  articleUrl = (await shelf.openArticle()).url();
});

test.afterAll(async () => {
  await shelf.close();
});

test('a first install opens the library, so its empty state can explain itself', async () => {
  expect(shelf.libraryOpenedOnInstall).toBe(true);
  await expect(shelf.library.locator('#results')).toContainText('Nothing saved yet');
  await expect(shelf.library.locator('#stats')).toHaveText('');
});

test('the fixture is a live control: the page itself loaded the other origin', () => {
  // If this ever fails, every "nothing was fetched" assertion below proves nothing: it would mean the
  // fixture's cross-origin files were unreachable, not that Shelf declined to fetch them.
  expect(shelf.site.hitsFromOtherOrigin().length).toBeGreaterThan(0);
  expect(shelf.site.otherOriginPaths()).toContain('/frame');
});

test('saves the page in the active tab', async () => {
  const outcome = await shelf.saveActiveTab();
  expect(outcome.status).toBe('saved');
  saved = pageFrom(outcome);

  expect(saved.title).toBe(FIXTURE.title);
  expect(saved.url).toBe(articleUrl);
  expect(saved.bytes).toBeGreaterThan(1000);
  expect(saved.wordCount).toBeGreaterThan(20);
  expect(saved.formatVersion).toBe(1);
  expect(saved.id).toHaveLength(32);
});

test('reads the page own files, and fetches nothing on another site', () => {
  // What the capture read, by its own account of the requests: one stylesheet, one fetch for each image
  // the page contains, and one attempt at the file that is not there. The page's own image loads are not
  // in this list - they were not script's doing - and neither is anything the capture had no business
  // touching.
  expect(shelf.site.hitsByScript().map((hit) => hit.path).sort()).toEqual([
    '/local.gif',
    '/local.gif',
    '/missing.png',
    '/sheet.css',
  ]);
  // The image the canvas was painted from is *not* fetched: what is stored is the canvas's pixels, which
  // is how a chart survives without the file it was drawn from.
  expect(shelf.site.hitsFor('/canvas-source.gif')).toHaveLength(0);

  // Nothing at all from the other origin: not the tracker, not the stylesheet, not the frame, and not
  // the media that the reader would have to ask for.
  expect(shelf.site.otherOriginPaths()).toEqual([]);

  // A page that asked the browser to navigate somewhere never got to.
  expect(shelf.site.hitsFor('/redirected')).toHaveLength(0);
  expect(shelf.site.hitsFor('/preload.js')).toHaveLength(0);
  expect(shelf.site.hitsFor('/post')).toHaveLength(0);
});

test('the archive keeps the page and leaves out everything that could run or navigate', async () => {
  const { page, html } = await shelf.stored(saved.id);
  expect(page?.id).toBe(saved.id);
  const archive = html ?? '';

  // Code, handlers, and the three ways a saved page could try to become the live one.
  expect(archive).not.toContain('<script');
  expect(archive).not.toContain('onclick');
  expect(archive).not.toContain('javascript:');
  expect(archive).not.toContain('formaction');
  expect(archive).not.toMatch(/<iframe|<noscript|<meta|http-equiv/i);
  expect(archive).toContain('data-shelf-skipped-frame');

  // Everything remote is kept as a record and detached, so the archive cannot fetch it by itself.
  expect(archive).toContain('data-shelf-remote-src=');
  expect(archive).toContain('data-shelf-remote-srcset=');
  expect(archive).toContain('data-shelf-remote-poster=');
  expect(archive).toContain('data-shelf-remote-stylesheet=');
  expect(archive).not.toMatch(/[\s"']src=["']http:\/\/localhost/);
  expect(archive).not.toMatch(/[\s"']poster=["']http:\/\/localhost/);
  // A stylesheet is the one reference that cannot be detached the way an image can, because the browser
  // has to be told not to use it: it stays in place as the record of what the page wanted, switched off.
  const remoteSheet =
    /<link[^>]*data-shelf-remote-stylesheet="http:\/\/localhost[^>]*>/.exec(archive)?.[0] ?? '';
  expect(remoteSheet).toContain('rel="stylesheet"');
  expect(remoteSheet).toContain('disabled');

  // What could be read is inlined, and the stylesheet remembers where it came from.
  expect(archive).toContain('data-shelf-from="http://127.0.0.1:31789/sheet.css"');
  expect(archive).toContain('.serif');
  expect(archive).toContain('src="data:image/gif;base64,');

  // Shadow content, which `cloneNode` alone would have dropped, and the text a careless round trip
  // through a reader or a store would mangle.
  expect(archive).toContain('data-shelf-shadow-root="host-card"');
  expect(archive).toContain('Shadow content that cloneNode would not copy.');
  expect(archive).toContain(FIXTURE.unicode);

  // Links resolved against the page they came from, so they still point where the page did.
  expect(archive).toContain(`href="${shelf.site.origin}/next"`);
});

test('a saved page is inert on its own, not only inside the reader', async () => {
  const { html } = await shelf.stored(saved.id);

  // The archive as a bare document: no reader, no policy, no Shelf. If it still reaches the network from
  // here, then the reader's policy was the only thing keeping it silent - which would mean the file
  // itself is not safe to keep, export, or open.
  const raw = await shelf.context.newPage();
  shelf.site.clear();
  await raw.setContent(html ?? '');
  await raw.waitForTimeout(500);

  expect(shelf.site.hits()).toEqual([]);
  await raw.close();
});

test('the canvas was saved as its pixels, at the size it had', async () => {
  const { html } = await shelf.stored(saved.id);
  const element = /<img[^>]+data-shelf-canvas[^>]*>/.exec(html ?? '')?.[0] ?? '';
  const base64 = /src="data:image\/png;base64,([^"]+)"/.exec(element)?.[1] ?? '';
  const png = Buffer.from(base64, 'base64');

  // A PNG's header carries the width and height at fixed offsets. Checking them is checking that the
  // capture read the real canvas rather than writing a placeholder of the right shape.
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(CANVAS.width);
  expect(png.readUInt32BE(20)).toBe(CANVAS.height);
});

test('the archive says what it could not save', async () => {
  const { page } = await shelf.stored(saved.id);
  const warnings = (page?.warnings ?? []).join(' ');

  expect(warnings).toContain('1 image could not be saved.');
  expect(warnings).toContain('1 embedded frame was not saved');
  expect(warnings).toMatch(/\d+ files on other sites were not saved locally\./);
});

test('finds the page by a word that appears only in its body text', async () => {
  const response = await shelf.search(FIXTURE.bodyWord);
  expect(response.total).toBe(1);
  expect(response.hits[0]?.page.id).toBe(saved.id);
  expect(response.hits[0]?.snippet).toContain(FIXTURE.bodyWord);
});

test('finds a phrase as written, in the words the page used', async () => {
  const response = await shelf.search(FIXTURE.phrase);
  expect(response.total).toBe(1);
  expect(response.hits[0]?.snippet).toContain(FIXTURE.phrase);
});

test('does not search what a reader never read: code, alt text, or a noscript block', async () => {
  for (const word of [FIXTURE.scriptWord, FIXTURE.altOnlyWord, FIXTURE.noscriptWord]) {
    const response = await shelf.search(word);
    expect(response.total).toBe(0);
  }
});

test('a query with nothing to look for returns nothing, rather than everything', async () => {
  const response = await shelf.search('the of and');
  expect(response.total).toBe(0);
});

test('saving the same page twice is one page, not two', async () => {
  const again = await shelf.saveActiveTab();
  expect(again.status).toBe('already-saved');
  expect(pageFrom(again).id).toBe(saved.id);
  expect((await shelf.stats()).count).toBe(1);
});
