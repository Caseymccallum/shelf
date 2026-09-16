/**
 * The library: recent pages, and search over everything.
 *
 * An empty screen is never ambiguous here. "Nothing saved yet" and "nothing matched" are different
 * facts and are worded differently, because a search box that silently shows nothing is the most
 * common way an archive feels broken when it is not.
 */

import {
  MSG_LIST,
  MSG_SEARCH,
  MSG_STATS,
  ask,
  type ListResponse,
  type SearchResponse,
  type StatsResponse,
} from '../../shared/messages';
import { formatBytes, formatCount } from '../../ui/format';
import { emptyRow, renderRow } from './rows';
import { downloadArchive, importArchive } from './transfer';
import '../../ui/theme.css';
import './style.css';

import { requireElement } from '../../ui/dom';

const queryInput = requireElement<HTMLInputElement>('#query');
const results = requireElement<HTMLUListElement>('#results');
const note = requireElement<HTMLParagraphElement>('#note');
const stats = requireElement<HTMLParagraphElement>('#stats');
const refresh = requireElement<HTMLButtonElement>('#refresh');
const transfer = requireElement<HTMLParagraphElement>('#transfer');
const exportButton = requireElement<HTMLButtonElement>('#export');
const importButton = requireElement<HTMLButtonElement>('#import');
const importFile = requireElement<HTMLInputElement>('#import-file');

const NOTHING_SAVED =
  'Nothing saved yet. Open a page and click Shelf in your toolbar — the page is saved into this browser, never to a server.';

/** Debounce, so typing eight characters asks the archive once instead of eight times. */
const SEARCH_DELAY_MS = 120;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

/** Draws the whole screen: the summary above, and the list below. */
export async function refreshAll(): Promise<void> {
  const statsResponse = (await ask({ type: MSG_STATS })) as StatsResponse;
  const { count, bytes } = statsResponse.stats;
  stats.textContent = count === 0 ? '' : `${formatCount(count)} · ${formatBytes(bytes)}`;

  const query = queryInput.value.trim();
  if (query === '') {
    const list = (await ask({ type: MSG_LIST, limit: 100 })) as ListResponse;
    note.textContent = '';
    results.replaceChildren(
      ...(list.pages.length === 0
        ? [emptyRow(NOTHING_SAVED)]
        : list.pages.map((page) => renderRow(page, '', () => void refreshAll()))),
    );
    return;
  }

  const response = (await ask({ type: MSG_SEARCH, query, limit: 100 })) as SearchResponse;
  note.textContent = response.note ?? `${response.hits.length} of ${formatCount(count)}`;
  results.replaceChildren(
    ...(response.hits.length === 0
      ? [emptyRow(NOTHING_SAVED)]
      : response.hits.map((hit) => renderRow(hit.page, hit.snippet, () => void refreshAll()))),
  );
}

queryInput.addEventListener('input', () => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void refreshAll(), SEARCH_DELAY_MS);
});

// Escape clears the search rather than making the reader select and delete it.
queryInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || queryInput.value === '') return;
  queryInput.value = '';
  void refreshAll();
});

refresh.addEventListener('click', () => void refreshAll());

/**
 * Runs one transfer, with its button disabled and what happened left on the line under the header.
 *
 * The archive is re-read afterwards whatever the outcome. An import that added nothing still happened,
 * and a screen that has to be refreshed by hand after an action is a screen that is wrong about the
 * archive until somebody does it.
 */
async function runTransfer(button: HTMLButtonElement, action: () => Promise<string>): Promise<void> {
  button.disabled = true;
  transfer.textContent = 'Working…';
  try {
    transfer.textContent = await action();
  } catch (error) {
    transfer.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    await refreshAll();
  }
}

exportButton.addEventListener('click', () => void runTransfer(exportButton, downloadArchive));

// The file input is the control that can do this; the button is what a person sees.
importButton.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', () => {
  const file = importFile.files?.[0];
  // Cleared before the file is read, so that choosing the same file twice is two imports: an input that
  // still holds a file fires no `change` event for it.
  importFile.value = '';
  if (file === undefined) return;

  void runTransfer(importButton, () =>
    importArchive(file, (done, total) => {
      transfer.textContent = `Importing ${done} of ${total}…`;
    }),
  );
});

void refreshAll();
