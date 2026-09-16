/**
 * The transfer format: what an export file is, and what an import will accept.
 *
 * An export is one JSON file that a person and a different program can both read: for each page, the
 * record's own fields, the archived HTML and the visible text, plus the versions that wrote it. There
 * is deliberately **no index** in it - `postings` is a cache, an importer rebuilds it by tokenizing
 * the text, and shipping a cache in an exported file would create a second source of truth that
 * could disagree with the pages it came from.
 *
 * The document is written as fragments - a header, runs of entries, a tail - rather than as one
 * string, because a library can be larger than one message can carry. The worker hands out a slice at
 * a time and the library page concatenates. The fragments must add up to exactly the document this
 * module would have written in one piece, and there is a test that says so.
 */

import { FORMAT_VERSION, type SavedPage } from './types';

/** What the file says it is, so a `.json` that is something else can be refused by name. */
export const EXPORT_KIND = 'shelf-export';

/**
 * The shape of the export file itself, which is a different thing from the format version of the
 * records inside it - the same distinction the archive draws between its schema and its records. A
 * reader that meets a newer file refuses it by number rather than guessing at fields it has not seen.
 */
export const EXPORT_FORMAT = 1;

/**
 * How many pages travel in one message.
 *
 * Small enough that a batch is never near a message size limit, large enough that a large library is
 * dozens of round trips rather than thousands.
 */
export const TRANSFER_BATCH_SIZE = 25;

/** One page as it travels: the record, the archived HTML, and the text that was indexed. */
export interface ArchiveEntry {
  page: SavedPage;
  html: string;
  text: string;
}

/** What the beginning of a document says about the rest of it. */
export interface ExportEnvelope {
  kind: typeof EXPORT_KIND;
  exportFormat: number;
  /** The record format version that wrote the entries. */
  formatVersion: number;
  exportedAt: number;
  /** How many entries the document holds, so a file that was cut short can be noticed. */
  count: number;
}

/** `shelf-2026-09-16.json`: dated, so a folder of exports sorts into a history. */
export function exportFilename(at: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `shelf-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.json`;
}

/** The envelope describing a document of `count` entries. */
export function exportEnvelope(count: number, exportedAt: number = Date.now()): ExportEnvelope {
  return {
    kind: EXPORT_KIND,
    exportFormat: EXPORT_FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt,
    count,
  };
}

/** The opening of the document, up to the point where the entries begin. */
export function exportHeader(envelope: ExportEnvelope): string {
  return (
    `{"kind":${JSON.stringify(envelope.kind)},"exportFormat":${envelope.exportFormat}` +
    `,"formatVersion":${envelope.formatVersion},"exportedAt":${envelope.exportedAt}` +
    `,"count":${envelope.count},"pages":[`
  );
}

/** A run of entries, comma-separated: runs joined with a comma between them are the `pages` array. */
export function exportChunk(entries: readonly ArchiveEntry[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join(',');
}

/** The end of the document. */
export function exportTail(): string {
  return ']}';
}

/** The whole document at once: for a caller that knows it fits, and for the test that checks the parts. */
export function exportDocument(entries: readonly ArchiveEntry[], exportedAt: number = Date.now()): string {
  return `${exportHeader(exportEnvelope(entries.length, exportedAt))}${exportChunk(entries)}${exportTail()}`;
}

/** What an import found in a file. */
export interface ParsedExport {
  entries: ArchiveEntry[];
  /** The record format version the file says wrote these records. */
  formatVersion: number;
  /** Entries that could not be read - counted rather than passed over, because a file that loses pages
   *  should be able to say so. */
  skipped: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * One entry, rebuilt field by field.
 *
 * A file's own claims are never spread into a record: an archive row carries two internal columns
 * (`text`, `tokens`) that no export contains, and a file is not a trusted source for the shape of a
 * row it did not create. `bytes` and `wordCount` are carried through because they are part of the
 * record, but the worker recomputes both from the content before writing, so a wrong number in a file
 * cannot make the library describe a page incorrectly.
 */
function entryFrom(value: unknown, formatVersion: number, fallbackSavedAt: number): ArchiveEntry | null {
  const raw = asRecord(value);
  if (raw === null) return null;
  const page = asRecord(raw.page);
  if (page === null) return null;

  const id = stringField(page.id);
  const url = stringField(page.url);
  const title = stringField(page.title);
  const html = stringField(raw.html);
  const bodyText = stringField(raw.text);
  if (id === null || url === null || title === null || html === null || bodyText === null) return null;

  const warnings = Array.isArray(page.warnings)
    ? page.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  return {
    page: {
      id,
      url,
      title,
      savedAt: numberField(page.savedAt, fallbackSavedAt),
      bytes: numberField(page.bytes, 0),
      wordCount: numberField(page.wordCount, 0),
      warnings,
      formatVersion: numberField(page.formatVersion, formatVersion),
    },
    html,
    text: bodyText,
  };
}

/**
 * Reads a file, or explains why it cannot be read.
 *
 * Unknown fields are ignored rather than refused, so a file written by a newer version that only
 * added something still imports; a newer *format* is refused by number, because a field whose meaning
 * changed cannot be detected by looking at fields.
 */
export function parseExport(source: string): ParsedExport {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('That file is not JSON, so it is not a Shelf export.');
  }

  const root = asRecord(value);
  if (root === null || root.kind !== EXPORT_KIND) {
    throw new Error('That JSON file is not a Shelf export.');
  }

  const exportFormat = numberField(root.exportFormat, 0);
  if (exportFormat > EXPORT_FORMAT) {
    throw new Error(
      `That export was written by a newer version of Shelf (export format ${exportFormat}). This version reads up to ${EXPORT_FORMAT}.`,
    );
  }

  if (!Array.isArray(root.pages)) {
    throw new Error('That export has no pages in it.');
  }

  const formatVersion = numberField(root.formatVersion, FORMAT_VERSION);
  const exportedAt = numberField(root.exportedAt, Date.now());
  const entries: ArchiveEntry[] = [];
  let skipped = 0;

  for (const candidate of root.pages) {
    const entry = entryFrom(candidate, formatVersion, exportedAt);
    if (entry === null) skipped += 1;
    else entries.push(entry);
  }

  if (entries.length === 0 && skipped > 0) {
    throw new Error(`None of the ${skipped} pages in that export could be read.`);
  }

  return { entries, formatVersion, skipped };
}
