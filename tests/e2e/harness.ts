/**
 * The harness: a real Chromium, the real built extension, and a real site on the other end.
 *
 * Two decisions worth knowing before reading a spec that uses this.
 *
 * **A fresh profile per spec file, not per test.** The extension runs for the length of a file, so the
 * tests inside a file describe a lifecycle - save, search, read, delete - against one archive, which is
 * the only way to test an archive application honestly. Each file still starts from nothing, because it
 * gets its own temporary browser profile.
 *
 * **Messages, not the DOM, for the plumbing.** The specs drive the extension through the same messages
 * the surfaces send, from a real extension page, so a test proves the worker's behaviour rather than
 * Playwright's ability to click inside a 400-pixel popup. The surfaces' own rendering is exercised by
 * opening the library and the viewer as pages, which is how a person reaches them anyway.
 */

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SavedPage, StatsSummary } from '../../src/core/types';
import {
  MSG_GET_PAGE,
  MSG_SAVE_ACTIVE_TAB,
  MSG_SEARCH,
  MSG_STATS,
  type GetPageResponse,
  type SaveOutcome,
  type SearchResponse,
  type StatsResponse,
} from '../../src/shared/protocol';
import { startFixtureSite, type FixtureSite } from './fixture-site';
import { E2E_EXTENSION_DIR } from './paths';

export interface Shelf {
  site: FixtureSite;
  context: BrowserContext;
  extensionId: string;
  /** The library, reached as a page first: a first install opens it, and this is that tab. */
  library: Page;
  /** The popup, opened as a page. The same document a click on the toolbar would show. */
  popup: Page;
  /** Whether the library opened by itself, which is what a first install promises. */
  libraryOpenedOnInstall: boolean;
  extensionUrl(path: string): string;
  /** Opens the fixture article in a new tab and waits until its own script has finished with it. */
  openArticle(): Promise<Page>;
  /** Saves whatever is in the active tab, the way the popup's Save button does. */
  saveActiveTab(options?: { page?: Page; clearLog?: boolean }): Promise<SaveOutcome>;
  /** Sends one request from an extension page. */
  ask<T>(request: unknown): Promise<T>;
  search(query: string): Promise<SearchResponse>;
  stored(id: string): Promise<{ page: SavedPage | null; html: string | null }>;
  stats(): Promise<StatsSummary>;
  close(): Promise<void>;
}

const INSTALL_TIMEOUT = 15_000;

/**
 * The one browser API the harness calls from inside a page: the extension's own message port.
 *
 * Declared here rather than pulled in from a types package, because this is the only part of the
 * extension API the harness touches, and a dependency that describes thousands of methods to type one
 * is a dependency that documents the toolchain instead of the code.
 */
interface ExtensionMessaging {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

/** The library tab: either already open, or about to be opened by the install handler. */
async function libraryPage(context: BrowserContext, url: string): Promise<{ page: Page; opened: boolean }> {
  const isLibrary = (page: Page): boolean => page.url().startsWith(url);
  const existing = context.pages().find(isLibrary);
  if (existing !== undefined) return { page: existing, opened: true };

  const announced = await context
    .waitForEvent('page', { predicate: isLibrary, timeout: INSTALL_TIMEOUT })
    .catch(() => null);

  const page = announced ?? (await context.newPage());
  if (!isLibrary(page)) await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  return { page, opened: announced !== null };
}

/** Launches the browser, loads the extension, and starts the fixture site. */
export async function launchShelf(): Promise<Shelf> {
  const site = await startFixtureSite();
  const userDataDir = mkdtempSync(join(tmpdir(), 'shelf-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    // `channel: 'chromium'` matters: it selects the full browser, which supports extensions, rather
    // than the headless shell, which does not.
    channel: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [
      `--disable-extensions-except=${E2E_EXTENSION_DIR}`,
      `--load-extension=${E2E_EXTENSION_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const extensionUrl = (path: string): string => `chrome-extension://${extensionId}/${path.replace(/^\//, '')}`;

  const { page: library, opened } = await libraryPage(context, extensionUrl('library.html'));
  const popup = await context.newPage();
  await popup.goto(extensionUrl('popup.html'));
  await popup.waitForLoadState('domcontentloaded');

  const ask = async <T>(request: unknown): Promise<T> =>
    (await library.evaluate(
      async (message) =>
        await (globalThis as unknown as { chrome: ExtensionMessaging }).chrome.runtime.sendMessage(message),
      request,
    )) as T;

  /** The last article opened, so "the active tab" is a thing a test chose rather than a race. */
  let article: Page | null = null;

  return {
    site,
    context,
    extensionId,
    library,
    popup,
    libraryOpenedOnInstall: opened,
    extensionUrl,

    async openArticle(): Promise<Page> {
      const page = await context.newPage();
      await page.goto(site.url('/article'), { waitUntil: 'load' });
      // The fixture paints its canvas and builds its shadow root from its own script. Waiting for the
      // canary is waiting for the page to exist: capturing a half-built page is a real problem, but it
      // is not the one being measured here.
      await page.waitForFunction(
        () => (window as unknown as Record<string, unknown>)['__shelfRuntime'] === 'drawn',
      );
      // Then the page is brought to the front and left to go quiet. Both halves matter: Chromium holds
      // some image work back while a tab is hidden, and a request that happens *after* a test's phase
      // marker would be counted as the capture's. Saving a page that is still loading is a real thing
      // that happens, and it is a different test than this one.
      await page.bringToFront();
      await page.waitForLoadState('networkidle');
      article = page;
      return page;
    },

    async saveActiveTab(options: { page?: Page; clearLog?: boolean } = {}): Promise<SaveOutcome> {
      // The worker saves the active tab, so the page has to be the one in front - which is also what
      // pressing Save while looking at an article means. The log is cleared first so that everything
      // left in it afterwards is something the *capture* did, not something the page did on load.
      const front = options.page ?? article ?? context.pages().find((page) => page.url().startsWith('http'));
      await front?.bringToFront();
      if (options.clearLog !== false) site.clear();
      const response = await ask<{ outcome: SaveOutcome }>({ type: MSG_SAVE_ACTIVE_TAB });
      return response.outcome;
    },

    ask,
    search: async (query) => await ask<SearchResponse>({ type: MSG_SEARCH, query }),
    stored: async (id) => await ask<GetPageResponse>({ type: MSG_GET_PAGE, id }),
    stats: async () => (await ask<StatsResponse>({ type: MSG_STATS })).stats,

    async close(): Promise<void> {
      await context.close();
      await site.stop();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
