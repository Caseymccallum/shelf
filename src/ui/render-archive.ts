/**
 * Preparing an archived page to be shown.
 *
 * The archive already cannot fetch anything by itself: scripts were never saved, and every reference
 * to another origin was moved into a `data-shelf-remote-*` attribute. This module is the second lock
 * on the same door, and it exists because "already cannot" is a claim about code that ran once,
 * possibly years ago, possibly in an older version.
 *
 * Three things happen here, and all three are about the reader's safety rather than the archive's
 * appearance:
 *
 * 1. A content-security policy is injected at read time, so a page opened from the archive cannot
 *    load or execute anything even if a reference survived.
 * 2. Links are made to open in a new tab, so clicking one cannot replace the archive with the live
 *    site - the archive should still be there when the reader comes back.
 * 3. Remote files are put back only when the reader has asked for them, one page at a time.
 */

/** What an archived page is allowed to reach: nothing, except the bytes stored inside it. */
export const READER_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'";

/**
 * The same, with the network allowed back for images, styles and fonts - never for scripts. This is
 * what the reader gets after explicitly asking to load a page's remote files, and the reason the
 * reader has to ask is that it means telling other servers which page you are looking at, years
 * after you looked at it.
 */
export const READER_CSP_WITH_REMOTE =
  "default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline' data: https: http:; font-src data: https: http:; media-src data: blob: https: http:; base-uri 'none'; form-action 'none'";

/** Attributes a detached reference was moved into, and the attribute it came from. */
const DETACHED_ATTRIBUTES = [
  ['data-shelf-remote-src', 'src'],
  ['data-shelf-remote-srcset', 'srcset'],
  ['data-shelf-remote-poster', 'poster'],
] as const;

/** How many files the capture could not save locally. */
export function countRemoteReferences(doc: Document): number {
  let count = 0;
  for (const [detached] of DETACHED_ATTRIBUTES) {
    count += doc.querySelectorAll(`[${detached}]`).length;
  }
  count += doc.querySelectorAll('link[data-shelf-remote-stylesheet]').length;
  return count;
}

/** Puts detached references back, and un-disables the stylesheets that were left pointing out. */
export function restoreRemoteReferences(doc: Document): number {
  let restored = 0;

  for (const [detached, attribute] of DETACHED_ATTRIBUTES) {
    for (const element of Array.from(doc.querySelectorAll(`[${detached}]`))) {
      const value = element.getAttribute(detached);
      if (value === null) continue;
      element.setAttribute(attribute, value);
      element.removeAttribute(detached);
      restored += 1;
    }
  }

  for (const link of Array.from(doc.querySelectorAll('link[data-shelf-remote-stylesheet]'))) {
    const href = link.getAttribute('data-shelf-remote-stylesheet');
    if (href === null) continue;
    link.setAttribute('href', href);
    link.removeAttribute('disabled');
    link.removeAttribute('data-shelf-remote-stylesheet');
    restored += 1;
  }

  return restored;
}

/** Parses an archived document for reading, without executing anything in it. */
export function parseArchive(html: string): Document {
  // `DOMParser` builds an inert document: no script runs, no image loads, nothing is fetched. This
  // is the only way the reader ever touches an archive's markup.
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * The markup to render in the reader's sandboxed frame.
 *
 * `allowRemote` is the reader's explicit instruction to fetch a page's unsaved files. Everything
 * else about the archived page stays exactly as it was captured.
 */
export function prepareArchiveForReading(html: string, options: { allowRemote?: boolean } = {}): string {
  const doc = parseArchive(html);

  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', options.allowRemote === true ? READER_CSP_WITH_REMOTE : READER_CSP);
  doc.head.prepend(policy);

  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    if (!/^https?:/i.test(anchor.getAttribute('href') ?? '')) continue;
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noreferrer noopener');
  }

  if (options.allowRemote === true) restoreRemoteReferences(doc);

  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
