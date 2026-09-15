/**
 * Rendering one archive row, and the two-step delete that belongs to it.
 *
 * Kept apart from the wiring so the interesting part - what a reader sees for a saved page, and how
 * hard it is to delete one by accident - can be read without following message passing.
 *
 * Every value a page contributes (title, address, snippet, warning) came from a page nobody here
 * wrote, so it reaches the document only through `textContent`.
 */

import { MSG_DELETE, ask } from '../../shared/messages';
import type { SavedPage } from '../../core/types';
import { domainOf, formatBytes, formatDate } from '../../ui/format';

/** Opens one saved page in the reader. */
export function openPage(id: string): void {
  location.href = `viewer.html?id=${encodeURIComponent(id)}`;
}

/**
 * The confirmation, which replaces the row's actions while it is open.
 *
 * Deletion is two clicks with the second one labelled, because an archive is the kind of thing people
 * regret losing and one stray click should not be able to do it.
 */
function confirmDelete(page: SavedPage, onChanged: () => void): HTMLElement {
  const step = document.createElement('span');
  step.className = 'delete-step';

  const question = document.createElement('span');
  question.textContent = 'Delete this page? ';

  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'danger';
  yes.textContent = 'Yes, delete it';
  yes.addEventListener('click', () => {
    void (async () => {
      await ask({ type: MSG_DELETE, id: page.id });
      onChanged();
    })();
  });

  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'quiet';
  keep.textContent = 'Keep';
  // Re-rendering the list is what puts the plain Delete button back: no state to get out of step.
  keep.addEventListener('click', () => onChanged());

  step.append(question, yes, ' ', keep);
  return step;
}

/** One row: what it is, where it came from, when it was saved, and the line that matched. */
export function renderRow(page: SavedPage, snippet: string, onChanged: () => void): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'result';

  const top = document.createElement('div');
  top.className = 'result-top';

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'link-button result-title';
  title.textContent = page.title;
  title.addEventListener('click', () => openPage(page.id));

  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = `${domainOf(page.url)} · ${formatDate(page.savedAt)} · ${formatBytes(page.bytes)}`;

  top.append(title, meta);
  item.append(top);

  if (snippet !== '') {
    const line = document.createElement('p');
    line.className = 'result-snippet';
    line.textContent = snippet;
    item.append(line);
  }

  const firstWarning = page.warnings[0];
  if (firstWarning !== undefined) {
    const warning = document.createElement('span');
    warning.className = 'badge';
    warning.textContent = firstWarning;
    item.append(warning);
  }

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  const read = document.createElement('button');
  read.type = 'button';
  read.className = 'quiet';
  read.textContent = 'Read';
  read.addEventListener('click', () => openPage(page.id));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => actions.replaceChildren(confirmDelete(page, onChanged)));

  actions.append(read, remove);
  item.append(actions);

  return item;
}

/** The row a reader sees when there is nothing to show, worded for the reason there is nothing. */
export function emptyRow(message: string): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'empty';
  item.textContent = message;
  return item;
}
