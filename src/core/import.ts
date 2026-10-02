/**
 * Reading files Shelf did not write: Pocket exports, browser bookmarks, and saved pages
 * (SingleFile and anything like it).
 *
 * These are the other direction of `core/export.ts`, and they follow the same rule: a file's claims
 * are never trusted for anything the archive can derive. Identity, byte size and word count are
 * recomputed by the worker on the way in, so every importer here only supplies what a file alone
 * knows - the address, the title, when it was saved, and what is in it.
 *
 * One honest distinction runs through all three formats. A Pocket export and a bookmarks file hold
 * **links, not pages**: there is no content to archive, and inventing some would make the library
 * claim more than it holds. Those become link-only records with a stub document that says exactly
 * that, so the address is findable in search and the reader tells the truth when it is opened.
 * A saved page (a SingleFile file) *is* content, and goes through the same cleanup a live capture
 * does - nothing executable survives.
 */

import type { ArchiveEntry } from './export';
import { extractText } from './text';
import { stripExecutable, absolutiseUrls } from '../capture/transform';
import { FORMAT_VERSION } from './types';

/**
 * What a link-only record says about itself.
 *
 * Placed on every record that has an address but no content, so the library, the reader and an
 * export all keep saying so - a warning travels with the record, wherever the record goes.
 */
export const LINK_ONLY_WARNING =
  'Saved as a link; the page itself was not in that file.';

/** The error a file that is none of the supported formats meets. */
export const UNKNOWN_FILE_MESSAGE =
  'Shelf can import its own exports, Pocket exports (CSV), browser bookmarks, and saved web pages. That file is none of those.';

/** Which kind of file a source is, or null when it is none Shelf can read. */
export type ImportFormat = 'shelf-export' | 'pocket' | 'bookmarks' | 'saved-page';

/** What one import produced. */
export interface ForeignResult {
  kind: 'pocket' | 'bookmarks' | 'saved-page';
  entries: ArchiveEntry[];
  /**
   * Rows and items that could not be read - a blank address, a line that is not a row. Counted and
   * reported rather than dropped silently, because an import that quietly loses half a file is
   * worse than one that says what it left out.
   */
  unreadable: number;
  /** Entries that are links only (address, title, tags - no page content). */
  links: number;
}

/**
 * Works out what a file is, from what is in it rather than what it is called.
 *
 * The file name is a hint only where content genuinely cannot distinguish formats - a bookmarks
 * export and a saved page are both HTML, and the Netscape header is the real evidence. A `.csv`
 * extension on a file whose first row is not Pocket's is not a Pocket export, and is refused rather
 * than half-read.
 */
export function detectImportFormat(source: string, filename = ''): ImportFormat | null {
  const head = source.slice(0, 2048).replace(/^\uFEFF/, '').trimStart();
  const lower = head.toLowerCase();

  if (lower.startsWith('{') || lower.startsWith('[')) return 'shelf-export';

  const firstLine = (head.split(/\r?\n/, 1)[0] ?? '').toLowerCase();
  if (firstLine.includes('title') && firstLine.includes('url') && firstLine.includes('time_added')) {
    return 'pocket';
  }

  if (lower.includes('netScape-bookmark-file'.toLowerCase()) || lower.includes('<dt><a href')) {
    return 'bookmarks';
  }
  if (filename.toLowerCase().includes('bookmark') && lower.includes('<a href')) return 'bookmarks';

  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return 'saved-page';

  return null;
}

/** What a file knows about one link, and nothing else. */
export interface LinkRecord {
  url: string;
  /** The title the file gave it, trimmed, falling back to the address itself. */
  title: string;
  /** When the file says it was saved, in ms. */
  savedAt: number;
  tags: string[];
}

/** Escapes everything a file's fields could carry into the stub's markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The one document a link-only record ever gets.
 *
 * A Pocket export and a bookmarks file hold addresses, not pages, and there is no content to
 * archive for them. Inventing a page would make the library claim more than it holds; refusing to
 * import them would throw away the one thing the file really knows. So the link becomes a record
 * whose document is this small honest stub - findable in search, and saying exactly what is missing
 * when the reader opens it.
 *
 * The stub is a pure function of the link's own fields (address, title, tags), which is what makes
 * importing the same file twice a no-op: the same link gives the same document, the same document
 * gives the same content hash, and the worker recognises it as already saved. Provenance takes no
 * part in it - the same link arriving from two different files is one link, not two.
 */
export function linkStubDocument(link: LinkRecord): string {
  const title = escapeHtml(link.title);
  const url = escapeHtml(link.url);
  const tags = link.tags.length > 0 ? `\n<p>Tags: ${escapeHtml(link.tags.join(', '))}</p>` : '';
  return (
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>` +
    `\n<body>\n<h1>${title}</h1>\n<p><a href="${url}">${url}</a></p>${tags}` +
    `\n<p>${LINK_ONLY_WARNING}</p>\n</body>\n</html>`
  );
}

/**
 * One link as an archive entry.
 *
 * `id`, `bytes` and `wordCount` are left empty on purpose: the worker derives all three from the
 * content on the way in, which is the same rule every import follows. The `text` copy is the stub's
 * visible text and nothing else, so phrase search can verify against what the reader would show.
 */
function linkEntry(link: LinkRecord): ArchiveEntry {
  const html = linkStubDocument(link);
  const parts = [link.title, link.url];
  if (link.tags.length > 0) parts.push(`Tags: ${link.tags.join(', ')}`);
  parts.push(LINK_ONLY_WARNING);

  return {
    page: {
      id: '',
      url: link.url,
      title: link.title,
      savedAt: link.savedAt,
      bytes: 0,
      wordCount: 0,
      warnings: [LINK_ONLY_WARNING],
      formatVersion: FORMAT_VERSION,
    },
    html,
    text: parts.join('\n'),
  };
}

/**
 * A Pocket export: one CSV part (`part_000000.csv`, ...), RFC 4180 quoting.
 *
 * Columns are `title,url,time_added,tags,status`. Kept: the address, the title, the time (epoch
 * seconds), and the tags (`tag1|tag2`). Knowingly not kept: **`status`** - whether Pocket considered
 * it read is Pocket's reading queue, not a property of the link, and it is named here rather than
 * dropped silently. Rows without an address cannot become records and are counted into
 * `unreadable`, so an import that left things behind says so.
 */
export function parsePocketCsv(source: string, fallbackSavedAt: number): ForeignResult {
  const rows = parseCsv(source);
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name);
  const at = (row: string[], index: number): string => (index >= 0 ? (row[index] ?? '') : '');

  const iTitle = column('title');
  const iUrl = column('url');
  const iTime = column('time_added');
  const iTags = column('tags');
  if (iUrl < 0) throw new Error('That file is not a Pocket export: it has no "url" column.');

  const entries: ArchiveEntry[] = [];
  let unreadable = 0;

  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell.trim() === '')) continue;
    const url = at(row, iUrl).trim();
    if (url === '') {
      unreadable += 1;
      continue;
    }

    const rawTitle = at(row, iTitle).trim();
    const seconds = Number(at(row, iTime).trim());
    const savedAt = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackSavedAt;
    const tags = at(row, iTags)
      .split('|')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');

    entries.push(linkEntry({ url, title: rawTitle === '' ? url : rawTitle, savedAt, tags }));
  }

  return { kind: 'pocket', entries, unreadable, links: entries.length };
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = source.replace(/^\uFEFF/, '');

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * A browser bookmarks file (the Netscape format every browser exports).
 *
 * Kept per link: the address, the title, `ADD_DATE`, and two kinds of tags - the `TAGS` attribute
 * Firefox writes, and the folder names the link sits under, which is how bookmarks without tags are
 * organised at all. `ADD_DATE` is seconds in Chrome's exports and microseconds in Firefox's, so the
 * timestamp is read by magnitude and the rule is written down rather than guessed per browser.
 * Non-web addresses (bookmarks to local files, `javascript:` snippets) are counted into
 * `unreadable`: a link-only record is honest only for something that is actually a page somewhere.
 */
export function parseBookmarks(source: string, fallbackSavedAt: number): ForeignResult {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const entries: ArchiveEntry[] = [];
  let unreadable = 0;

  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const url = (anchor.getAttribute('href') ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      unreadable += 1;
      continue;
    }

    const title = (anchor.textContent ?? '').trim();
    const tags = [
      ...(anchor.getAttribute('tags') ?? '').split(','),
      ...folderNamesOf(anchor),
    ]
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');

    entries.push(
      linkEntry({
        url,
        title: title === '' ? url : title,
        savedAt: bookmarkTime(anchor.getAttribute('add_date') ?? '', fallbackSavedAt),
        tags: [...new Set(tags)],
      }),
    );
  }

  return { kind: 'bookmarks', entries, unreadable, links: entries.length };
}

/**
 * The folders a bookmark sits under, outermost first.
 *
 * The Netscape format introduces a folder with an `<h3>` beside (or above) the `<dl>` that contains
 * its links, and the exact nesting is whatever the HTML parser in front of us makes of it. Both
 * shapes are read; a link at the top level gets no folder rather than an invented one.
 */
function folderNamesOf(anchor: Element): string[] {
  const names: string[] = [];
  for (
    let list: Element | null = anchor.closest('dl');
    list !== null;
    list = list.parentElement?.closest('dl') ?? null
  ) {
    const intro =
      list.previousElementSibling?.tagName === 'H3'
        ? list.previousElementSibling
        : list.parentElement?.tagName === 'DT'
          ? list.parentElement.querySelector(':scope > h3')
          : null;
    const name = (intro?.textContent ?? '').trim();
    if (name !== '') names.unshift(name);
  }
  return names;
}

/** Reads `ADD_DATE` whatever unit the exporting browser used. */
function bookmarkTime(value: string, fallback: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  if (raw > 1e14) return Math.round(raw / 1000); // microseconds (Firefox)
  if (raw > 1e11) return raw; // milliseconds
  return raw * 1000; // seconds (Chrome and most tools)
}

/**
 * A saved web page - a SingleFile export, or anything else that is one complete HTML document.
 *
 * This is the one foreign format that carries real content, so it is cleaned exactly as a live
 * capture is: nothing executable survives (`capture/transform.ts`, the product's promise rather than
 * this module's opinion), and every URL is resolved before the page's own base goes with it. The
 * visible text is extracted after the cleanup, so what is indexed is what the cleaned page shows.
 *
 * Where the page came from is recovered from the document (canonical link, `og:url`, `<base>`,
 * SingleFile's own `url:` banner comment) before those elements are stripped; when none of them
 * says, the record carries a warning instead of a guessed address. `savedAt` is the file's own
 * last-written time - the only time the file itself knows.
 */
export function parseSavedPage(source: string, fallbackSavedAt: number): ForeignResult {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const copy = doc.documentElement;

  const url = originalUrlOf(source, doc);
  const title =
    (doc.querySelector('title')?.textContent ?? '').trim() || (url !== '' ? url : 'Saved page');

  // What a browser would resolve the page's own relative URLs against: its `<base>` when it declares
  // one, its address otherwise. Read before the cleanup, which takes the `<base>` away.
  const baseHref = doc.querySelector('base')?.getAttribute('href') ?? null;
  const base = /^https?:\/\//i.test((baseHref ?? '').trim()) ? (baseHref ?? '').trim() : url;
  if (base !== '') absolutiseUrls(copy, base);
  const skippedFrames = stripExecutable(copy);

  const warnings: string[] = [];
  if (url === '') warnings.push('The file does not say what page this came from.');
  if (skippedFrames === 1) warnings.push('1 embedded frame was not saved.');
  else if (skippedFrames > 1) warnings.push(`${skippedFrames} embedded frames were not saved.`);

  return {
    kind: 'saved-page',
    links: 0,
    unreadable: 0,
    entries: [
      {
        page: {
          id: '',
          url,
          title,
          savedAt: fallbackSavedAt,
          bytes: 0,
          wordCount: 0,
          warnings,
          formatVersion: FORMAT_VERSION,
        },
        html: `<!doctype html>\n${copy.outerHTML}`,
        text: extractText(copy),
      },
    ],
  };
}

/** The page's own address, recovered before the elements holding it are cleaned away. */
function originalUrlOf(source: string, doc: Document): string {
  const isWeb = (value: string | null): boolean => /^https?:\/\//i.test((value ?? '').trim());

  const canonical = doc.querySelector('link[rel~="canonical"]')?.getAttribute('href') ?? null;
  if (isWeb(canonical)) return (canonical ?? '').trim();

  const og = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null;
  if (isWeb(og)) return (og ?? '').trim();

  const base = doc.querySelector('base')?.getAttribute('href') ?? null;
  if (isWeb(base)) return (base ?? '').trim();

  // SingleFile's banner comment names the address in `url:` form; the exact banner varies between
  // versions, so this is one recovery route among several rather than the only one.
  const banner = source.slice(0, 8192).match(/\burl:\s*(https?:\/\/[^\s"'>]+)/i);
  if (banner?.[1] !== undefined) return banner[1];

  return '';
}

/**
 * Reads any supported foreign file, or explains why it cannot.
 *
 * The shelf's own export format is not handled here - it has its own reader in `core/export.ts`
 * with its own claims about versions. This dispatch is for everything else.
 */
export function parseForeignFile(
  source: string,
  filename: string,
  fallbackSavedAt: number,
): ForeignResult {
  switch (detectImportFormat(source, filename)) {
    case 'pocket':
      return parsePocketCsv(source, fallbackSavedAt);
    case 'bookmarks':
      return parseBookmarks(source, fallbackSavedAt);
    case 'saved-page':
      return parseSavedPage(source, fallbackSavedAt);
    default:
      throw new Error(UNKNOWN_FILE_MESSAGE);
  }
}