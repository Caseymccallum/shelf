/**
 * Extracting the text a reader would actually see.
 *
 * `innerText` is the obvious tool and is deliberately not used. It depends on layout, so it is
 * unavailable in a unit test, differs between engines, and returns nothing at all for a detached
 * document - which would leave the search index provable only by running a browser. A deterministic
 * walk over the DOM gives the same answer everywhere, and that is the property that lets the index
 * be tested at all.
 *
 * The walk runs on the *captured* document (after shadow roots have been flattened and scripts
 * removed), so what is indexed and what can be re-rendered are the same content.
 */

/** Elements whose text is not prose: code, styles, and machine-readable leftovers. */
const SKIPPED_ELEMENTS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'SVG',
  'CANVAS',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'AUDIO',
  'VIDEO',
]);

/** Elements that end a line, so paragraphs and list items do not run into each other. */
const BLOCK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
  'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH',
  'THEAD', 'TR', 'UL',
]);

/** True when an element asks not to be read out: hidden, or explicitly hidden from assistive tech. */
function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const style = element.getAttribute('style');
  return style !== null && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

/**
 * The document's visible text, one block per line.
 *
 * Whitespace inside a line is collapsed: HTML source formatting (indentation, newlines inside a
 * paragraph) is not content, and keeping it would corrupt phrase matching.
 */
export function extractText(root: Document | Element): string {
  const lines: string[] = [];
  let current = '';

  const flush = (): void => {
    const line = current.replace(/\s+/g, ' ').trim();
    if (line !== '') lines.push(line);
    current = '';
  };

  const walk = (node: Node): void => {
    if (node.nodeType === 3 /* text */) {
      current += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1 /* element */) return;

    const element = node as Element;
    // `tagName` is uppercase for HTML elements and keeps its case for anything in another namespace
    // (an SVG `<text>` is `svg`/`text`, not `SVG`), so the comparison has to normalise: without this
    // the text drawn inside a chart ends up in the search index.
    const tag = element.tagName.toUpperCase();
    if (SKIPPED_ELEMENTS.has(tag) || isHidden(element)) return;

    const block = BLOCK_ELEMENTS.has(tag);
    if (block) flush();
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) flush();
  };

  walk(root);
  flush();
  return lines.join('\n');
}
