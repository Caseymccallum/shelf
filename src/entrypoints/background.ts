/**
 * The service worker: the only place a save happens.
 *
 * Everything user-facing sends a message here rather than touching the archive itself, for one
 * reason: a save is three writes and an injected page read, and splitting that across surfaces is
 * how an archive ends up with an index that disagrees with its pages. One caller, one transaction.
 *
 * The worker holds no state between events. That is not a limitation to work around - it is why
 * every message arrives with everything needed to answer it.
 */

import { capturePage } from '../capture/capture-lifecycle';
import { FORMAT_VERSION, type SavedPage } from '../core/types';
import { tokenize } from '../core/tokens';
import {
  MSG_DELETE,
  MSG_GET_PAGE,
  MSG_LIST,
  MSG_SAVE_ACTIVE_TAB,
  MSG_SEARCH,
  MSG_STATS,
  type ShelfRequest,
  type ShelfResponse,
} from '../shared/messages';
import {
  archivePage,
  archiveStats,
  deletePage,
  getPage,
  getPageContent,
  listPages,
  searchPages,
} from '../storage/db';

/** Pages whose address makes no sense to archive, named so the refusal can explain itself. */
function refusalFor(url: string): string | null {
  if (/^https?:/i.test(url)) return null;
  if (/^(chrome|edge|about|chrome-extension|moz-extension):/i.test(url)) {
    return 'Shelf cannot read browser or extension pages. Open an ordinary web page and try again.';
  }
  if (/^file:/i.test(url)) {
    return 'Shelf cannot read local files unless you allow file access for it in the extensions page.';
  }
  return `Shelf cannot read "${url.split(':')[0] ?? 'this'}:" pages.`;
}

/**
 * A page's identity: the SHA-256 of its archived HTML, shortened to 128 bits.
 *
 * Content, not address, because the same article saved twice is one thing to read, and a page that
 * changed since last time is a different one worth keeping. 128 bits is far beyond collision
 * territory for an archive and keeps keys and URLs short.
 */
async function contentId(html: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function saveActiveTab(): Promise<ShelfResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) {
    return { type: MSG_SAVE_ACTIVE_TAB, outcome: { status: 'failed', reason: 'No page to save.' } };
  }

  const refusal = refusalFor(tab.url);
  if (refusal !== null) {
    return { type: MSG_SAVE_ACTIVE_TAB, outcome: { status: 'failed', reason: refusal } };
  }

  let captured;
  try {
    captured = await capturePage(tab.id);
  } catch (error) {
    return {
      type: MSG_SAVE_ACTIVE_TAB,
      outcome: {
        status: 'failed',
        reason: `The page could not be read: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  const id = await contentId(captured.html);
  const existing = await getPage(id);
  if (existing !== null) {
    return { type: MSG_SAVE_ACTIVE_TAB, outcome: { status: 'already-saved', page: existing } };
  }

  const page: SavedPage = {
    id,
    url: captured.url,
    title: captured.title,
    savedAt: Date.now(),
    bytes: new TextEncoder().encode(captured.html).length,
    // The count of *indexed* tokens, so it means the same thing to the ranker as it does here.
    wordCount: tokenize(captured.text).length,
    warnings: captured.warnings,
    formatVersion: FORMAT_VERSION,
  };

  await archivePage({ page, html: captured.html, text: captured.text });
  return { type: MSG_SAVE_ACTIVE_TAB, outcome: { status: 'saved', page } };
}

/** Answers one message. Written as a lookup rather than chained conditionals, so adding a message
 *  is one entry and the exhaustive switch below is what fails when one is forgotten. */
async function handle(request: ShelfRequest): Promise<ShelfResponse> {
  switch (request.type) {
    case MSG_SAVE_ACTIVE_TAB:
      return saveActiveTab();

    case MSG_LIST: {
      const { pages, total } = await listPages(request.limit ?? 100, request.offset ?? 0);
      return { type: MSG_LIST, pages, total };
    }

    case MSG_SEARCH: {
      const { hits, note } = await searchPages(request.query, request.limit ?? 50);
      return note === undefined
        ? { type: MSG_SEARCH, hits, total: hits.length }
        : { type: MSG_SEARCH, hits, total: hits.length, note };
    }

    case MSG_GET_PAGE: {
      const page = await getPage(request.id);
      if (page === null) return { type: MSG_GET_PAGE, page: null, html: null };
      const content = await getPageContent(request.id);
      return { type: MSG_GET_PAGE, page, html: content?.html ?? null };
    }

    case MSG_DELETE:
      return { type: MSG_DELETE, deleted: await deletePage(request.id) };

    case MSG_STATS:
      return { type: MSG_STATS, stats: await archiveStats() };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => handle(message as ShelfRequest));

  // A first install opens the library, so the empty state can explain itself. On an update it does
  // not: taking over a tab to announce a new version is the behaviour Shelf exists to avoid.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void browser.tabs.create({ url: browser.runtime.getURL('/library.html') });
  });
});
