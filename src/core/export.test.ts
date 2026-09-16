/**
 * The transfer format, tested as a contract rather than as a function.
 *
 * Two of these tests exist because of promises the documentation makes: that an export followed by an
 * import restores the same records, and that the fragments the worker sends add up to exactly the file
 * this module would have written in one piece. If the second one ever fails, an exported file is
 * subtly malformed in a way only a person with a text editor would notice.
 */

import { describe, expect, test } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_KIND,
  TRANSFER_BATCH_SIZE,
  exportChunk,
  exportDocument,
  exportEnvelope,
  exportFilename,
  exportHeader,
  exportTail,
  parseExport,
  type ArchiveEntry,
} from './export';
import type { SavedPage } from './types';

/** One entry, with a page whose fields can be overridden one at a time. */
function entry(id: string, overrides: Partial<SavedPage> = {}, html = `<p>${id}</p>`, text = id): ArchiveEntry {
  return {
    page: {
      id,
      url: `https://example.test/${id}`,
      title: `Page ${id}`,
      savedAt: 1_700_000_000_000,
      bytes: html.length,
      wordCount: text.split(' ').length,
      warnings: [],
      formatVersion: 1,
      ...overrides,
    },
    html,
    text,
  };
}

describe('exportFilename', () => {
  test('is dated, so a folder of exports sorts into a history', () => {
    expect(exportFilename(new Date(2026, 8, 16))).toBe('shelf-2026-09-16.json');
  });

  test('pads a single-digit month and day', () => {
    expect(exportFilename(new Date(2026, 0, 5))).toBe('shelf-2026-01-05.json');
  });
});

describe('exportDocument', () => {
  test('names itself and counts what it holds', () => {
    const document = exportDocument([entry('one'), entry('two')], 1_700_000_000_000);
    const parsed = JSON.parse(document) as Record<string, unknown>;

    expect(parsed.kind).toBe(EXPORT_KIND);
    expect(parsed.exportFormat).toBe(EXPORT_FORMAT);
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.exportedAt).toBe(1_700_000_000_000);
    expect(parsed.count).toBe(2);
    expect(parsed.pages).toHaveLength(2);
  });

  test('holds no index: a cache in a file could disagree with the pages it came from', () => {
    const document = exportDocument([entry('one')], 1_700_000_000_000);
    expect(document).not.toContain('postings');
    expect(document).not.toContain('"tokens"');
  });

  test('is a valid empty archive, so a library with nothing in it still exports', () => {
    const parsed = parseExport(exportDocument([], 1_700_000_000_000));
    expect(parsed.entries).toEqual([]);
    expect(parsed.skipped).toBe(0);
  });
});

describe('the fragments a batched export is sent as', () => {
  test('concatenate into exactly the document written in one piece', () => {
    // Three batches, which is what the worker sends for a library of this size at a smaller batch size.
    const entries = [entry('one'), entry('two'), entry('three')];
    const exportedAt = 1_700_000_000_000;

    const fragments = [
      exportHeader(exportEnvelope(entries.length, exportedAt)),
      exportChunk([entries[0] as ArchiveEntry]),
      ',',
      exportChunk([entries[1] as ArchiveEntry, entries[2] as ArchiveEntry]),
      exportTail(),
    ];

    expect(fragments.join('')).toBe(exportDocument(entries, exportedAt));
  });

  test('a run of no entries is empty rather than a stray comma', () => {
    expect(exportChunk([])).toBe('');
  });

  test('the batch size is small enough to be a message and large enough to be a round trip', () => {
    expect(TRANSFER_BATCH_SIZE).toBeGreaterThan(1);
    expect(TRANSFER_BATCH_SIZE).toBeLessThanOrEqual(100);
  });
});

describe('parseExport', () => {
  test('restores every field of every record', () => {
    const original = entry('one', { warnings: ['2 images could not be saved'], savedAt: 1_699_000_000_000 });
    const parsed = parseExport(exportDocument([original], 1_700_000_000_000));

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toEqual(original);
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.skipped).toBe(0);
  });

  test('survives HTML that is awkward to put in JSON', () => {
    // The characters that break a hand-rolled serializer: quotes, backslashes, newlines, a script end
    // tag, a CDATA end, and text that is not ASCII.
    const html =
      '<p title="a\\b">line one\nline two</p><script>if (a < b) {}</script>]]>&#x2014; 日本語 “quotes”';
    const text = 'line one line two';
    const parsed = parseExport(exportDocument([entry('one', {}, html, text)], 1_700_000_000_000));

    expect(parsed.entries[0]?.html).toBe(html);
    expect(parsed.entries[0]?.text).toBe(text);
  });

  test('refuses something that is not JSON, by name', () => {
    expect(() => parseExport('this is not json at all')).toThrow(/not JSON/);
  });

  test('refuses JSON that is not a Shelf export', () => {
    expect(() => parseExport('{"hello":"world"}')).toThrow(/not a Shelf export/);
    expect(() => parseExport('[1,2,3]')).toThrow(/not a Shelf export/);
  });

  test('refuses an export written by a newer version, by number rather than by guesswork', () => {
    const newer = `{"kind":"${EXPORT_KIND}","exportFormat":${EXPORT_FORMAT + 1},"pages":[]}`;
    expect(() => parseExport(newer)).toThrow(/newer version of Shelf/);
  });

  test('refuses a file whose pages are not pages', () => {
    expect(() => parseExport(`{"kind":"${EXPORT_KIND}","exportFormat":1,"pages":"none"}`)).toThrow(
      /no pages in it/,
    );
  });

  test('refuses a file from which nothing at all could be read', () => {
    const broken = `{"kind":"${EXPORT_KIND}","exportFormat":1,"pages":[{"page":{}},{"nope":true}]}`;
    expect(() => parseExport(broken)).toThrow(/None of the 2 pages/);
  });

  test('keeps the entries it can read and counts the ones it cannot', () => {
    const mixed = `{"kind":"${EXPORT_KIND}","exportFormat":1,"formatVersion":1,"exportedAt":5,"pages":[
      {"page":{"id":"one","url":"https://example.test/one","title":"One"},"html":"<p>one</p>","text":"one"},
      {"page":{"id":"two","url":"https://example.test/two","title":"Two"},"text":"no html at all"}
    ]}`;
    const parsed = parseExport(mixed);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.page.id).toBe('one');
    expect(parsed.skipped).toBe(1);
  });

  test('tolerates an older or minimal file: missing warnings, missing timestamp, unknown fields', () => {
    const minimal = `{"kind":"${EXPORT_KIND}","exportFormat":1,"exportedAt":42,"futureField":true,"pages":[
      {"page":{"id":"one","url":"https://example.test/one","title":"One","somethingNew":7},"html":"<p>one</p>","text":"one"}
    ]}`;
    const parsed = parseExport(minimal);
    const page = parsed.entries[0]?.page;

    expect(page?.warnings).toEqual([]);
    expect(page?.savedAt).toBe(42);
    // The format version of a record with no version of its own is the file's.
    expect(page?.formatVersion).toBe(1);
  });

  test('does not carry the file own extra fields into a stored record', () => {
    // `tokens` and `text` are the archive's internal columns. A file that claims them must not be able
    // to overwrite what the import computes for itself.
    const sneaky = `{"kind":"${EXPORT_KIND}","exportFormat":1,"pages":[
      {"page":{"id":"one","url":"https://example.test/one","title":"One","tokens":{"evil":99}},"html":"<p>one</p>","text":"one"}
    ]}`;
    const page = parseExport(sneaky).entries[0]?.page as unknown as Record<string, unknown>;

    expect(Object.keys(page).sort()).toEqual([
      'bytes',
      'formatVersion',
      'id',
      'savedAt',
      'title',
      'url',
      'warnings',
      'wordCount',
    ]);
  });
});
