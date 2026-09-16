/**
 * The message protocol between Shelf's surfaces.
 *
 * The popup, the library and the viewer all talk to the service worker rather than to the database
 * directly, for one reason: the capture happens in the worker's world (it injects into the page and
 * then writes the archive), and splitting the write path in two is how archives end up with an
 * index that disagrees with their contents.
 *
 * The vocabulary itself lives in `protocol.ts`, which imports nothing at all - so the harness that
 * drives the real extension can name the same messages without pulling a browser into a Node process.
 */

import { browser } from 'wxt/browser';
import type { ShelfRequest, ShelfResponse } from './protocol';

export * from './protocol';

/** Sends a request and fails loudly if the worker answers with an error instead of a shape. */
export async function ask(request: ShelfRequest): Promise<ShelfResponse> {
  return (await browser.runtime.sendMessage(request)) as ShelfResponse;
}
