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
import {
  TRANSFER_BATCH_SIZE,
  exportChunk,
  exportEnvelope,
  exportFilename,
  exportHeader,
  exportTail,
  type ArchiveEntry,
} from '../core/export';
import { FORMAT_VERSION, type SavedPage } from '../core/types';
import { tokenize } from '../core/tokens';
import {
  MSG_DELETE,
  MSG_EXPORT,
  MSG_GET_PAGE,
  MSG_IMPORT,
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
  exportSlice,
  getPage,
  getPageContent,
  importPages,
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
/** One encoder for the worker, used wherever text becomes bytes. */
const ENCODER = new TextEncoder();

/** The size of a page's HTML, counted the way a record counts it. */
function byteLength(html: string): number {
  return ENCODER.encode(html).length;
}

async function contentId(html: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENCODER.encode(html));
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
    bytes: byteLength(captured.html),
    // The count of *indexed* tokens, so it means the same thing to the ranker as it does here.
    wordCount: tokenize(captured.text).length,
    warnings: captured.warnings,
    formatVersion: FORMAT_VERSION,
  };

  await archivePage({ page, html: captured.html, text: captured.text });
  return { type: MSG_SAVE_ACTIVE_TAB, outcome: { status: 'saved', page } };
}

/**
 * Hands out one batch of an export file.
 *
 * The worker keeps nothing between batches - it holds no state by design - so the caller names the
 * offset it wants each time. A batch that fails is then simply a batch that can be asked for again.
 */
async function exportBatch(offset: number, limit: number): Promise<ShelfResponse> {
  const { entries, total, nextOffset } = await exportSlice(limit, offset);

  return {
    type: MSG_EXPORT,
    // The envelope is written once, by the batch that starts the walk: an export's own timestamp
    // should be the moment it began, not the moment each piece of it was assembled.
    header: offset === 0 ? exportHeader(exportEnvelope(total)) : '',
    chunk: exportChunk(entries),
    entries: entries.length,
    tail: nextOffset >= total ? exportTail() : '',
    nextOffset,
    total,
    filename: exportFilename(),
  };
}

/**
 * Writes pages that came from a file.
 *
 * Identity is derived from the content here rather than taken from the file, which is the same rule a
 * save follows, and so are the two numbers derived from the content - so a file cannot make the
 * library describe a page incorrectly. What the file *is* trusted for is what only it knows: the
 * address, the title, when the page was saved, and what the capture warned about at the time.
 */
async function importBatch(entries: readonly ArchiveEntry[]): Promise<ShelfResponse> {
  const prepared: ArchiveEntry[] = [];
  let rekeyed = 0;

  for (const entry of entries) {
    const id = await contentId(entry.html);
    if (id !== entry.page.id) rekeyed += 1;

    prepared.push({
      html: entry.html,
      text: entry.text,
      page: {
        ...entry.page,
        id,
        bytes: byteLength(entry.html),
        wordCount: tokenize(entry.text).length,
      },
    });
  }

  const counts = await importPages(prepared);
  return { type: MSG_IMPORT, added: counts.added, skipped: counts.skipped, rekeyed };
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

    case MSG_EXPORT:
      return exportBatch(request.offset ?? 0, request.limit ?? TRANSFER_BATCH_SIZE);

    case MSG_IMPORT:
      return importBatch(request.entries);
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
