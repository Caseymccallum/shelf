/**
 * The popup: one primary action, and the truth about what happened.
 *
 * Everything a page contributes here - its title - is text from a page Shelf did not write, so it is
 * only ever inserted with `textContent`. A saved page's title is untrusted input, and the popup is a
 * page that can run code; the two must not meet through `innerHTML`.
 */

import {
  MSG_SAVE_ACTIVE_TAB,
  MSG_STATS,
  ask,
  type SaveOutcome,
  type StatsResponse,
} from '../../shared/messages';
import { formatBytes, formatCount } from '../../ui/format';
import '../../ui/theme.css';
import './style.css';

import { requireElement } from '../../ui/dom';

const saveButton = requireElement<HTMLButtonElement>('#save');
const status = requireElement<HTMLParagraphElement>('#status');
const summary = requireElement<HTMLParagraphElement>('#summary');
const openLibrary = requireElement<HTMLButtonElement>('#open-library');

/** Replaces the status line, optionally offering one action alongside it. */
function setStatus(
  message: string,
  options: { tone?: 'good' | 'poor'; action?: { label: string; run: () => void } } = {},
): void {
  status.textContent = message;
  if (options.tone === undefined) status.removeAttribute('data-tone');
  else status.setAttribute('data-tone', options.tone);

  if (options.action !== undefined) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.textContent = options.action.label;
    const run = options.action.run;
    button.addEventListener('click', run);
    status.append(' ', button);
  }
}

async function refreshSummary(): Promise<void> {
  const response = (await ask({ type: MSG_STATS })) as StatsResponse;
  const { count, bytes } = response.stats;
  summary.textContent =
    count === 0 ? 'Nothing saved yet.' : `${formatCount(count)} · ${formatBytes(bytes)} saved`;
}

function describe(outcome: SaveOutcome): void {
  switch (outcome.status) {
    case 'saved':
      setStatus(`Saved "${outcome.page.title}"`, { tone: 'good' });
      return;
    case 'already-saved':
      setStatus(`"${outcome.page.title}" is already in your library`, {
        tone: 'good',
        action: {
          label: 'Open it',
          run: () => {
            void browser.tabs.create({
              url: browser.runtime.getURL(`/viewer.html?id=${encodeURIComponent(outcome.page.id)}`),
            });
          },
        },
      });
      return;
    case 'failed':
      setStatus(outcome.reason, { tone: 'poor' });
      return;
  }
}

async function runSave(): Promise<void> {
  saveButton.disabled = true;
  setStatus('Saving this page…');

  try {
    const response = await ask({ type: MSG_SAVE_ACTIVE_TAB });
    if (response.type === MSG_SAVE_ACTIVE_TAB) describe(response.outcome);
    await refreshSummary();
  } catch (error) {
    setStatus(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`, {
      tone: 'poor',
    });
  } finally {
    saveButton.disabled = false;
  }
}

saveButton.addEventListener('click', () => void runSave());
openLibrary.addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/library.html') });
});

void refreshSummary();
