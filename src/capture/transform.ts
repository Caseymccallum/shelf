/**
 * Turning a live document into an archive.
 *
 * The rules here are the product's promise, stated once:
 *
 * 1. **Nothing executable survives.** Scripts, frames, inline event handlers and `javascript:` links
 *    are removed, so an archived page cannot run code in the reader - a saved page is data, and
 *    treating someone else's page as code years later is how archives become attack vectors.
 * 2. **Nothing fetches the network unless the reader asks.** Same-origin resources are inlined;
 *    anything that stays remote is counted so the reader can say "12 files were not saved locally"
 *    and offer to load them, rather than reaching out silently when the page is opened.
 * 3. **Nothing is dropped quietly.** Everything the capture could not do lands in `warnings`,
 *    because a reader that loses half a page without saying so is worse than one that admits it.
 *
 * It takes a `Document` plus a `Fetcher`, so every rule above is a unit test over a fixture document
 * rather than something only a browser can prove.
 */

import { extractText } from '../core/text';
import type { CaptureOptions, CaptureResult, Fetcher } from './types';

/** Elements whose content is code or machine data, not the page a reader saw. */
const DROPPED_ELEMENTS = ['script', 'noscript', 'template', 'meta', 'base', 'object', 'embed'];

/**
 * Attributes that execute, or that would make a careless renderer execute, once the archive is
 * opened. Removed rather than sanitised: a saved page has no reason to keep them.
 */
const DANGEROUS_ATTRIBUTES = [
  'onload', 'onerror', 'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmouseenter', 'onmouseleave', 'onmousemove', 'onsubmit', 'oninput', 'onchange', 'onfocus',
  'onblur', 'onkeydown', 'onkeyup', 'onkeypress', 'oncopy', 'onpaste', 'ontouchstart',
  'onpointerdown', 'onanimationstart', 'ontransitionend', 'srcdoc', 'formaction',
];

/** Attributes whose values are URLs that must be resolved before the page's base is gone. */
const URL_ATTRIBUTES: Record<string, readonly string[]> = {
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'],
};

/** Resolves a possibly-relative URL against the document that contained it. */
function absoluteUrl(value: string, base: string): string {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function isRemote(value: string): boolean {
  return /^(?:https?|ftp):/i.test(value);
}

function isInline(value: string): boolean {
  return /^(?:data|blob|about):/i.test(value);
}

/**
 * Rewrites `url(...)` references inside a stylesheet so a saved page's images and fonts resolve
 * against the page they came from rather than against the reader.
 */
function absolutiseCss(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote: string, target: string) => {
    if (target.startsWith('data:') || target.startsWith('#')) return whole;
    return `url("${absoluteUrl(target, base)}")`;
  });
}

/** Removes everything executable from a copied document. */
export function stripExecutable(copy: HTMLElement): void {
  for (const tag of DROPPED_ELEMENTS) {
    for (const element of Array.from(copy.querySelectorAll(tag))) element.remove();
  }

  for (const element of Array.from(copy.querySelectorAll('*'))) {
    for (const name of DANGEROUS_ATTRIBUTES) element.removeAttribute(name);
    // `integrity`, `nonce` and `crossorigin` mean nothing in an archive; the resource they describe
    // is either inline now or explicitly reported as missing.
    for (const name of ['integrity', 'nonce', 'crossorigin']) element.removeAttribute(name);
    const href = element.getAttribute('href');
    if (href !== null && /^\s*javascript:/i.test(href)) element.removeAttribute('href');
  }

  // Every `<link>` that is not a stylesheet goes: `preload`, `prefetch`, `preconnect`, `icon` and
  // `manifest` all describe a page that is being *loaded*, and some of them fetch when a document
  // is parsed. Stylesheet links are left for the inlining pass, which either inlines them or
  // disables them - never leaves them live.
  for (const link of Array.from(copy.querySelectorAll('link'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet')) continue;
    link.remove();
  }

  // Embedded frames belong to another page at another address. Copying their contents in would put
  // someone else's document inside this archive under this page's address, so they are replaced
  // with a marker that says exactly what is missing.
  for (const frame of Array.from(copy.querySelectorAll('frame, iframe'))) {
    const marker = copy.ownerDocument.createElement('div');
    marker.setAttribute('data-shelf-skipped-frame', frame.getAttribute('src') ?? '');
    marker.textContent = '[embedded frame not saved]';
    frame.replaceWith(marker);
  }
}

/**
 * Flattens shadow roots into the light DOM.
 *
 * A component-based page saved without this renders as a column of empty custom elements - the
 * difference between an archive and a screenshot of one. `cloneNode` does not copy shadow roots, so
 * the shadow content has to be read from the *live* tree and written into the copy: the two trees
 * are paired by document order over their light DOM, which is structurally identical, and each
 * shadow tree is flattened the same way in turn. Like `snapshotCanvases`, this must run before
 * anything else edits the copy, while the two trees still line up.
 */
export function flattenShadowRoots(
  liveRoot: Element | ShadowRoot,
  copyRoot: HTMLElement,
  doc: Document,
): void {
  const liveElements = Array.from(liveRoot.querySelectorAll('*'));
  const copiedElements = Array.from(copyRoot.querySelectorAll('*'));

  liveElements.forEach((live, index) => {
    const copied = copiedElements[index];
    const shadow = live.shadowRoot;
    if (copied === undefined || shadow === null) return;

    const shadowCopy = doc.createElement('div');
    shadowCopy.innerHTML = shadow.innerHTML;
    flattenShadowRoots(shadow, shadowCopy, doc);

    const wrapper = doc.createElement('div');
    wrapper.setAttribute('data-shelf-shadow-root', live.tagName.toLowerCase());
    wrapper.innerHTML = shadowCopy.innerHTML;
    copied.appendChild(wrapper);
  });
}

/** Resolves every URL in the copy, so it no longer depends on where it is rendered. */
export function absolutiseUrls(copy: HTMLElement, base: string): void {
  /** Resolves a `srcset` list: `url descriptor` pairs, comma separated. */
  const resolveSrcset = (value: string): string =>
    value
      .split(',')
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate !== '')
      .map((candidate) => {
        // Handing the whole list to `new URL` would percent-encode the space before the descriptor
        // and produce a URL that 404s, so each candidate is split into its URL and its descriptor.
        const [first, ...descriptor] = candidate.split(/\s+/);
        if (first === undefined || first === '') return candidate;
        return [isInline(first) ? first : absoluteUrl(first, base), ...descriptor].join(' ');
      })
      .join(', ');

  for (const [tag, attributes] of Object.entries(URL_ATTRIBUTES)) {
    for (const element of Array.from(copy.querySelectorAll(tag))) {
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value === null || value === '' || isInline(value) || value.startsWith('#')) continue;
        element.setAttribute(attribute, attribute === 'srcset' ? resolveSrcset(value) : absoluteUrl(value, base));
      }
    }
  }

  for (const anchor of Array.from(copy.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href');
    // A fragment must stay a fragment: resolved against the page it would point at the live site,
    // but in an archive "jump to the section" means the copy the reader is looking at.
    if (href === null || href === '' || isInline(href) || href.startsWith('#')) continue;
    anchor.setAttribute('href', absoluteUrl(href, base));
  }

  for (const sheet of Array.from(copy.querySelectorAll('style'))) {
    if (sheet.textContent !== null) sheet.textContent = absolutiseCss(sheet.textContent, base);
  }
  for (const element of Array.from(copy.querySelectorAll('[style]'))) {
    const style = element.getAttribute('style');
    if (style !== null) element.setAttribute('style', absolutiseCss(style, base));
  }
}

/** What the inlining passes report back, collected in one place so the summary is honest. */
export interface InliningState {
  /** References left pointing at the network, for the reader to offer as an opt-in. */
  remote: number;
  maxResourceBytes: number;
  warnings: string[];
}

/**
 * True when a URL belongs to the page being saved, and so can be read without new permissions.
 *
 * A relative URL is resolved against the page first: the transform always resolves URLs before
 * inlining, but a function that silently declines to inline because it was handed `/a.png` would
 * produce an archive that quietly depends on the network, which is the one thing this file exists
 * to prevent.
 */
export function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    return new URL(url, pageUrl).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Replaces same-origin stylesheet links with inline `<style>` elements.
 *
 * Stylesheets are inlined rather than linked because a linked one would be fetched from the network
 * when the archive is opened - which is exactly what a saved page must not do.
 */
export async function inlineSameOriginStylesheets(
  copy: HTMLElement,
  pageUrl: string,
  fetcher: Fetcher,
  state: InliningState,
): Promise<void> {
  const links = Array.from(copy.querySelectorAll('link[rel~="stylesheet"]'));
  let failed = 0;

  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (href === '') continue;
    const target = absoluteUrl(href, pageUrl);
    if (!isSameOrigin(target, pageUrl)) continue;

    const css = await fetcher.text(target);
    if (css === null) {
      failed += 1;
      continue;
    }
    const style = copy.ownerDocument.createElement('style');
    style.setAttribute('data-shelf-from', target);
    style.textContent = absolutiseCss(css, target);
    link.replaceWith(style);
  }

  if (failed > 0) {
    state.warnings.push(`${failed} stylesheet${failed === 1 ? '' : 's'} could not be saved, so some styling is missing.`);
  }
}

/** Replaces same-origin images with data URLs; the rest are dealt with by `detachRemoteReferences`. */
export async function inlineSameOriginImages(
  copy: HTMLElement,
  pageUrl: string,
  fetcher: Fetcher,
  state: InliningState,
): Promise<void> {
  let failed = 0;

  for (const image of Array.from(copy.querySelectorAll('img[src]'))) {
    const src = image.getAttribute('src') ?? '';
    if (src === '' || isInline(src)) continue;
    const target = absoluteUrl(src, pageUrl);
    if (!isSameOrigin(target, pageUrl)) continue;

    const resource = await fetcher.dataUrl(target);
    if (resource === null) {
      failed += 1;
      continue;
    }
    if (resource.bytes > state.maxResourceBytes) {
      state.warnings.push(`An image over ${Math.round(state.maxResourceBytes / 1024)} kB was not saved locally.`);
      continue;
    }
    image.setAttribute('src', resource.dataUrl);
    image.removeAttribute('srcset');
  }

  if (failed > 0) {
    state.warnings.push(`${failed} image${failed === 1 ? '' : 's'} could not be saved.`);
  }
}

/**
 * Makes every remaining remote reference inert, and counts it.
 *
 * `src` becomes `data-shelf-remote-src` (and `srcset` likewise) so the archived page *cannot* fetch
 * anything by itself. The reader can put them back, one page and one confirmation at a time - which
 * is the same bargain mail clients offer, for the same reason. A `<link>` cannot be made inert the
 * same way, so it is marked disabled and left in place as the record of what the page wanted.
 */
export function detachRemoteReferences(
  copy: HTMLElement,
  options: { includeSameOrigin?: boolean } = {},
): number {
  let detached = 0;
  // With resource inlining switched off, nothing was inlined, so *every* network reference has to
  // be detached - otherwise a "fast save" would produce an archive that quietly fetches when opened.
  const shouldDetach = (value: string): boolean =>
    !isInline(value) && (isRemote(value) || options.includeSameOrigin === true);

  for (const [tag, attributes] of Object.entries(URL_ATTRIBUTES)) {
    for (const element of Array.from(copy.querySelectorAll(tag))) {
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value === null || !shouldDetach(value)) continue;
        element.removeAttribute(attribute);
        element.setAttribute(`data-shelf-remote-${attribute}`, value);
        if (attribute === 'src' || attribute === 'poster') detached += 1;
      }
    }
  }

  for (const link of Array.from(copy.querySelectorAll('link[rel~="stylesheet"]'))) {
    const href = link.getAttribute('href');
    if (href === null) continue;
    // Whatever is left after the inlining pass points at the network - either it is on another
    // origin, or a same-origin read failed. It is kept as the record of what the page wanted,
    // disabled so the archive cannot fetch it by itself, and counted so the reader can offer to
    // load it deliberately.
    link.setAttribute('disabled', '');
    link.setAttribute('data-shelf-remote-stylesheet', href);
    detached += 1;
  }

  return detached;
}

/**
 * Reads the canvases back as images and swaps them into the copy.
 *
 * A canvas holds pixels that exist nowhere in the DOM, so a DOM-only capture of a chart, a game or
 * a drawing tool is a blank rectangle. The two trees are walked in document order before shadow
 * roots are flattened, so their canvas sequences still line up exactly.
 *
 * Known limit, stated rather than hidden: a canvas inside a web component's shadow root is not
 * paired. Capturing it would mean mutating the live page to mark it, and Shelf does not touch the
 * pages it reads.
 */
export function snapshotCanvases(live: Document, copy: HTMLElement, warnings: string[]): number {
  const liveCanvases = Array.from(live.querySelectorAll('canvas'));
  const copiedCanvases = Array.from(copy.querySelectorAll('canvas'));
  let replaced = 0;
  let unreadable = 0;

  copiedCanvases.forEach((canvas, index) => {
    const original = liveCanvases[index];
    if (original === undefined) return;

    let dataUrl: string;
    try {
      dataUrl = original.toDataURL('image/png');
    } catch {
      unreadable += 1;
      return;
    }
    if (dataUrl === '' || dataUrl === 'data:,') return;

    const image = copy.ownerDocument.createElement('img');
    image.setAttribute('src', dataUrl);
    image.setAttribute('data-shelf-canvas', '');
    for (const attribute of ['class', 'style', 'width', 'height', 'id', 'alt', 'aria-label']) {
      const value = canvas.getAttribute(attribute);
      if (value !== null) image.setAttribute(attribute, value);
    }
    canvas.replaceWith(image);
    replaced += 1;
  });

  if (unreadable > 0) {
    warnings.push(`${unreadable} canvas${unreadable === 1 ? '' : 'es'} could not be read and will appear blank.`);
  }
  return replaced;
}

/** The page's title, with two fallbacks so a saved page is never filed under nothing. */
export function titleOf(doc: Document, copy: HTMLElement): string {
  const candidates = [
    doc.title,
    copy.querySelector('title')?.textContent ?? '',
    copy.querySelector('h1')?.textContent ?? '',
    doc.location.hostname,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.replace(/\s+/g, ' ').trim();
    if (trimmed !== '') return trimmed.slice(0, 300);
  }
  return 'Untitled page';
}

/**
 * Captures a document into an archive record.
 *
 * The order is load-bearing: canvases are paired before shadow roots are flattened (so the two
 * trees still match), executable content is removed before anything is inlined (so nothing
 * incomplete is fetched on behalf of a script), and remote references are detached last (so
 * everything inlinable has already been inlined).
 */
export async function captureDocument(
  doc: Document,
  fetcher: Fetcher,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const pageUrl = doc.location.href;
  const state: InliningState = {
    remote: 0,
    maxResourceBytes: options.maxResourceBytes ?? 4 * 1024 * 1024,
    warnings: [],
  };

  const copy = doc.documentElement.cloneNode(true) as HTMLElement;
  // These two pair the live tree with the copy, so they must run while the two still line up:
  // anything that edits the copy first (removing elements, replacing frames) breaks the pairing.
  snapshotCanvases(doc, copy, state.warnings);
  flattenShadowRoots(doc.documentElement, copy, doc);
  stripExecutable(copy);
  absolutiseUrls(copy, pageUrl);

  if (options.inlineResources !== false) {
    await inlineSameOriginStylesheets(copy, pageUrl, fetcher, state);
    await inlineSameOriginImages(copy, pageUrl, fetcher, state);
  }

  state.remote = detachRemoteReferences(copy, { includeSameOrigin: options.inlineResources === false });
  if (state.remote > 0) {
    state.warnings.push(
      `${state.remote} file${state.remote === 1 ? '' : 's'} on other sites ${state.remote === 1 ? 'was' : 'were'} not saved locally.`,
    );
  }

  return {
    html: `<!doctype html>\n${copy.outerHTML}`,
    text: extractText(copy),
    title: titleOf(doc, copy),
    url: pageUrl,
    warnings: state.warnings,
    remoteResources: state.remote,
  };
}


