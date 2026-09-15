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
import '../../ui/theme.css';
import './style.css';

import { requireElement } from '../../ui/dom';

const queryInput = requireElement<HTMLInputElement>('#query');
const results = requireElement<HTMLUListElement>('#results');
const note = requireElement<HTMLParagraphElement>('#note');
const stats = requireElement<HTMLParagraphElement>('#stats');
const refresh = requireElement<HTMLButtonElement>('#refresh');

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

void refreshAll();
