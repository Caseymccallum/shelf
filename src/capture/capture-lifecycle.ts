/**
 * Running the capture inside a tab.
 *
 * Two injections, because they have different jobs. The **file** does the work: `capture.js` is
 * bundled at build time, so it can use the tested transform and everything it imports. The
 * **function** reads the result back out of the page's global scope - Chrome resolves whatever an
 * injected function returns, which is how an injection that returns nothing becomes an answer.
 *
 * The injected file is never declared in the manifest. A page you have not saved should not have
 * Shelf in it at all, and `activeTab` is enough to inject on demand.
 */

import type { CaptureResult } from './types';

/** The file `scripts/*` and WXT produce for `entrypoints/capture.ts`. */
const CAPTURE_FILE = 'capture.js';

/**
 * The slice of `chrome.scripting` this uses.
 *
 * Typed locally rather than taken from `browser.scripting`, because the two browser flavours type
 * this API differently and the shape used here is the intersection that both accept. Anything more
 * would be a type that documents the toolchain rather than the behaviour.
 */
interface ScriptingApi {
  executeScript(injection: {
    target: { tabId: number };
    files?: string[];
    func?: () => unknown;
  }): Promise<{ result?: unknown }[]>;
}

function scripting(): ScriptingApi {
  const api = (browser as unknown as { scripting?: ScriptingApi }).scripting;
  if (api === undefined) throw new Error('This browser does not support on-demand injection.');
  return api;
}

/** Captures the page in `tabId`, or throws with a message a user can read. */
export async function capturePage(tabId: number): Promise<CaptureResult> {
  const api = scripting();

  await api.executeScript({ target: { tabId }, files: [CAPTURE_FILE] });

  const [injection] = await api.executeScript({
    target: { tabId },
    func: () => (globalThis as unknown as { __shelfCapture?: Promise<unknown> }).__shelfCapture,
  });

  // The value is the promise the injected file left behind, so awaiting it awaits the capture.
  const captured = (await injection?.result) as CaptureResult | undefined;
  if (captured === undefined || captured === null || typeof captured !== 'object') {
    throw new Error('The page did not return anything to save.');
  }
  return captured;
}
