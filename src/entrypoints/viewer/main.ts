/**
 * The reader: one saved page, shown as it was, plus the honest account of what is missing.
 *
 * Two things this file is careful about. The archived markup is prepared by `render-archive.ts`,
 * which injects a policy that forbids the page from reaching the network and makes its links open in
 * a new tab. And when files could not be saved locally, the reader says so and offers to fetch them -
 * because loading them means telling other servers which page you are looking at, years later, which
 * is not a decision to make silently on somebody's behalf.
 */

import {
  MSG_DELETE,
  MSG_GET_PAGE,
  ask,
  type GetPageResponse,
} from '../../shared/messages';
import type { SavedPage } from '../../core/types';
import { countRemoteReferences, parseArchive, prepareArchiveForReading } from '../../ui/render-archive';
import { domainOf, formatBytes, formatDate } from '../../ui/format';
import '../../ui/theme.css';
import './style.css';

import { requireElement } from '../../ui/dom';

const titleElement = requireElement<HTMLHeadingElement>('#title');
const metaElement = requireElement<HTMLParagraphElement>('#meta');
const notes = requireElement<HTMLParagraphElement>('#notes');
const frame = requireElement<HTMLIFrameElement>('#frame');
const backButton = requireElement<HTMLButtonElement>('#back');
const deleteButton = requireElement<HTMLButtonElement>('#delete');

const id = new URLSearchParams(location.search).get('id') ?? '';
let page: SavedPage | null = null;
let html = '';
let remoteCount = 0;

function toLibrary(): void {
  location.href = 'library.html';
}

/** The one place the reader talks about what is missing, and the one place it offers to fix it. */
function renderNotes(): void {
  notes.replaceChildren();
  if (page === null) {
    notes.hidden = true;
    return;
  }

  notes.hidden = false;
  if (remoteCount > 0) {
    const note = document.createElement('span');
    note.className = 'badge';
    note.textContent =
      remoteCount === 1
        ? '1 file was not saved locally'
        : `${remoteCount} files were not saved locally`;
    notes.append(note);

    if (notes.dataset.remoteLoading !== 'true') {
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'link-button';
      load.textContent = 'Load them from the network';
      load.addEventListener('click', () => {
        notes.dataset.remoteLoading = 'true';
        // The only place Shelf fetches anything on a reader's behalf, and only because they asked.
        frame.srcdoc = prepareArchiveForReading(html, { allowRemote: true });
        void renderNotes();
      });
      notes.append(load);
    } else {
      notes.append(' Loading them now — this page told other sites you opened it.');
    }
  }

  for (const warning of page.warnings) {
    const line = document.createElement('span');
    line.className = 'badge';
    line.textContent = warning;
    notes.append(line);
  }
}

function render(): void {
  if (page === null) {
    titleElement.textContent = 'Not in your library';
    metaElement.textContent = 'This page is not saved here, or it was deleted.';
    notes.hidden = true;
    frame.srcdoc = '';
    return;
  }

  titleElement.textContent = page.title;
  metaElement.textContent = `${domainOf(page.url)} · saved ${formatDate(page.savedAt)} · ${formatBytes(page.bytes)}`;
  frame.srcdoc = prepareArchiveForReading(html);
  void renderNotes();
}

backButton.addEventListener('click', toLibrary);

deleteButton.addEventListener('click', () => {
  if (page === null) return;
  // Two steps, with the second one named: an archive is the kind of thing people regret losing.
  if (deleteButton.dataset.confirming !== 'true') {
    deleteButton.dataset.confirming = 'true';
    deleteButton.textContent = 'Yes, delete it';
    return;
  }
  void (async () => {
    await ask({ type: MSG_DELETE, id: page?.id ?? '' });
    toLibrary();
  })();
});

void (async () => {
  if (id === '') {
    render();
    return;
  }

  const response = (await ask({ type: MSG_GET_PAGE, id })) as GetPageResponse;
  page = response.page;
  html = response.html ?? '';
  remoteCount = html === '' ? 0 : countRemoteReferences(parseArchive(html));
  document.title = page === null ? 'Shelf — not saved' : `Shelf — ${page.title}`;
  render();
})();
