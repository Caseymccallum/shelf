/**
 * The capture shell: the only Shelf code that ever runs inside somebody else's page.
 *
 * It is deliberately tiny. Its job is to hand the page's own `fetch` to `captureDocument`, keep the
 * result on a global, and get out of the way - because this file runs in that page's world, and
 * every line here is a line that could misbehave in a page nobody controls. The rules it obeys
 * (nothing executable survives, nothing remote is fetched later, nothing is dropped quietly) live
 * in `src/capture/transform.ts`, where they can be tested against fixture documents.
 *
 * Injected on demand by the worker, never declared in the manifest: a page you have not saved
 * should not have Shelf in it at all.
 */
import { captureDocument } from '../capture/transform';

declare global {
  interface Window {
    /** Set by this script and read straight back by the injector. */
    __shelfCapture?: Promise<unknown>;
  }
}

/** Reads bytes out of the page's own origin, with the page's own credentials. */
const pageFetcher = {
  async text(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  },
  async dataUrl(url: string): Promise<{ dataUrl: string; bytes: number } | null> {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) return null;
      const blob = await response.blob();
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      return dataUrl === null ? null : { dataUrl, bytes: blob.size };
    } catch {
      return null;
    }
  },
};

export default defineUnlistedScript(() => {
  window.__shelfCapture = captureDocument(document, pageFetcher, { inlineResources: true });
});
