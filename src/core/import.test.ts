/**
 * The foreign importers, tested as contracts rather than as functions.
 *
 * Three promises are worth more than the parsing details: that a link-only record says it is one,
 * that importing the same file twice is a no-op (the stub is a pure function of the link), and that
 * a saved page is cleaned exactly as a live capture is - because "nothing executable survives" is
 * the product's promise, not the capture module's private opinion.
 */

import { describe, expect, test } from 'vitest';
import {
  LINK_ONLY_WARNING,
  UNKNOWN_FILE_MESSAGE,
  detectImportFormat,
  linkStubDocument,
  parseBookmarks,
  parseForeignFile,
  parsePocketCsv,
  parseSavedPage,
} from './import';

const FALLBACK = 1_700_000_000_000;

const POCKET_CSV = [
  'title,url,time_added,tags,status',
  'An article,https://example.test/a,1726000000,reading|work,archive',
  '"Comma, and ""quotes""",https://example.test/b,1726100000,,unread',
  ',https://example.test/c,1726200000,,unread',
  'No address at all,,,missing,unread',
].join('\n');

describe('detectImportFormat', () => {
  test('knows a shelf export by its JSON, whatever it is named', () => {
    expect(detectImportFormat('{"kind":"shelf-export"}')).toBe('shelf-export');
  });

  test('knows a Pocket export by its header row', () => {
    expect(detectImportFormat('title,url,time_added,tags,status\n')).toBe('pocket');
  });

  test('knows a bookmarks file by its Netscape header, not its filename', () => {
    const source = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://x.test">x</A></DL>';
    expect(detectImportFormat(source)).toBe('bookmarks');
    expect(detectImportFormat(source, 'pocket.csv')).toBe('bookmarks');
  });

  test('knows a saved page by its markup', () => {
    expect(detectImportFormat('<!doctype html><html><body>hi</body></html>')).toBe('saved-page');
  });

  test('refuses a CSV that is not Pocket\'s, rather than half-reading it', () => {
    expect(detectImportFormat('name,email\na,b\n')).toBeNull();
    expect(() => parseForeignFile('name,email\na,b\n', 'x.csv', FALLBACK)).toThrow(
      UNKNOWN_FILE_MESSAGE,
    );
  });
});

describe('parsePocketCsv', () => {
  test('keeps the address, title, time and tags, and says what it left out', () => {
    const result = parsePocketCsv(POCKET_CSV, FALLBACK);

    expect(result.kind).toBe('pocket');
    expect(result.entries).toHaveLength(3);
    expect(result.unreadable).toBe(1); // the row with no address
  });

  test('reads quoting the way a CSV quotes: commas and doubled quotes inside a field', () => {
    const result = parsePocketCsv(POCKET_CSV, FALLBACK);
    expect(result.entries[1]?.page.title).toBe('Comma, and "quotes"');
  });

  test('turns epoch seconds into milliseconds, and falls back to the file\'s time when absent', () => {
    const result = parsePocketCsv(POCKET_CSV, FALLBACK);
    expect(result.entries[0]?.page.savedAt).toBe(1_726_000_000_000);
  });

  test('splits Pocket\'s pipe-separated tags, and drops read-state quietly no more', () => {
    const result = parsePocketCsv(POCKET_CSV, FALLBACK);
    expect(result.entries[0]?.text).toContain('Tags: reading, work');
    // `status` is knowingly not kept - named in the module docs rather than smuggled into a tag.
    expect(result.entries[0]?.text).not.toContain('archive');
    expect(result.entries[0]?.text).not.toContain('unread');
  });

  test('a title the file did not fill in falls back to the address', () => {
    const result = parsePocketCsv(POCKET_CSV, FALLBACK);
    expect(result.entries[2]?.page.title).toBe('https://example.test/c');
  });

  test('refuses a CSV without a url column by name', () => {
    expect(() => parsePocketCsv('title\nx\n', FALLBACK)).toThrow('no "url" column');
  });
});

describe('link-only records', () => {
  const link = {
    url: 'https://example.test/x?a=1&b=2',
    title: 'A title',
    savedAt: FALLBACK,
    tags: ['t'],
  };

  test('say what they are: a warning on the record and the same words in the document', () => {
    const result = parsePocketCsv(
      'title,url,time_added,tags,status\nA title,https://example.test/x?a=1&b=2,1726000000,t,unread\n',
      FALLBACK,
    );
    const entry = result.entries[0];

    expect(entry?.page.warnings).toContain(LINK_ONLY_WARNING);
    expect(entry?.html).toContain(LINK_ONLY_WARNING);
  });

  test('are a pure function of the link, so the same file twice is the same archive', () => {
    expect(linkStubDocument(link)).toBe(linkStubDocument({ ...link }));
    // ...and the same link from two different files is one link, not two.
    expect(linkStubDocument(link)).toBe(linkStubDocument({ ...link, savedAt: FALLBACK + 5_000 }));
  });

  test('carry nothing executable into the stub, whatever a title contains', () => {
    const html = linkStubDocument({
      ...link,
      title: '<script>alert(1)</script>',
      url: 'https://example.test/"><img onerror=x>',
    });
    // The fields escape rather than break out: no tag closes, no attribute opens.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img');
  });

  test('are searchable by their title and tags: the text is what the stub shows', () => {
    const result = parsePocketCsv(
      'title,url,time_added,tags,status\nA title,https://example.test/x,1726000000,t,unread\n',
      FALLBACK,
    );
    const entry = result.entries[0];
    expect(entry?.text).toContain('A title');
    expect(entry?.text).toContain('Tags: t');
  });
});

describe('parseBookmarks', () => {
  const SOURCE = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<DL><p>',
    '  <DT><H3>Work</H3>',
    '  <DL><p>',
    '    <DT><A HREF="https://example.test/1" ADD_DATE="1726000000" TAGS="one,two">First</A>',
    '    <DT><A HREF="https://example.test/2" ADD_DATE="1726000000000000">Second</A>',
    '    <DT><A HREF="file:///C:/notes.txt" ADD_DATE="1726000000">Local</A>',
    '  </DL><p>',
    '  <DT><A HREF="https://example.test/3">Third</A>',
    '</DL><p>',
  ].join('\n');

  test('reads every web link, and counts the ones that are not pages anywhere', () => {
    const result = parseBookmarks(SOURCE, FALLBACK);
    expect(result.kind).toBe('bookmarks');
    expect(result.entries).toHaveLength(3);
    expect(result.unreadable).toBe(1); // the file: bookmark
  });

  test('tags a link with its folder and its own tags, without doubling them', () => {
    const result = parseBookmarks(SOURCE, FALLBACK);
    expect(result.entries[0]?.text).toContain('Tags: one, two, Work');
  });

  test('reads ADD_DATE in seconds (Chrome) and microseconds (Firefox) alike', () => {
    const result = parseBookmarks(SOURCE, FALLBACK);
    expect(result.entries[0]?.page.savedAt).toBe(1_726_000_000_000);
    expect(result.entries[1]?.page.savedAt).toBe(1_726_000_000_000);
  });

  test('a link outside any folder keeps no folder rather than an invented one', () => {
    const result = parseBookmarks(SOURCE, FALLBACK);
    expect(result.entries[2]?.text).not.toContain('Tags:');
    expect(result.entries[2]?.text).not.toContain('Work');
  });
});

describe('parseSavedPage', () => {
  const SAVED = [
    '<!doctype html>',
    '<!-- Page saved with SingleFile url: https://example.test/article -->',
    '<html><head>',
    '<title>A saved article</title>',
    '<base href="https://example.test/dir/">',
    '<link rel="canonical" href="https://example.test/article">',
    '</head><body>',
    '<h1>A saved article</h1>',
    '<p>Body words worth finding.</p>',
    '<script>fetch("https://evil.test")</script>',
    '<img src="pic.png" onerror="alert(1)">',
    '<iframe src="https://frame.test/x"></iframe>',
    '</body></html>',
  ].join('\n');

  test('recovers the page\'s own address from the document before cleanup', () => {
    const result = parseSavedPage(SAVED, FALLBACK);
    expect(result.entries[0]?.page.url).toBe('https://example.test/article');
    expect(result.entries[0]?.page.title).toBe('A saved article');
    expect(result.entries[0]?.page.warnings).toEqual(['1 embedded frame was not saved.']);
  });

  test('cleans a saved page exactly as a live capture does: nothing executable survives', () => {
    const result = parseSavedPage(SAVED, FALLBACK);
    const html = result.entries[0]?.html ?? '';
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<iframe');
  });

  test('resolves the page\'s own URLs before its base is taken away', () => {
    const result = parseSavedPage(SAVED, FALLBACK);
    expect(result.entries[0]?.html).toContain('src="https://example.test/dir/pic.png"');
  });

  test('indexes the text the cleaned page shows, not the markup', () => {
    const result = parseSavedPage(SAVED, FALLBACK);
    expect(result.entries[0]?.text).toContain('Body words worth finding.');
    expect(result.entries[0]?.text).not.toContain('fetch(');
  });

  test('warns rather than guessing when the file says nothing about its address', () => {
    const result = parseSavedPage(
      '<!doctype html><html><head><title>T</title></head><body>x</body></html>',
      FALLBACK,
    );
    expect(result.entries[0]?.page.url).toBe('');
    expect(result.entries[0]?.page.warnings).toContain(
      'The file does not say what page this came from.',
    );
    expect(result.entries[0]?.page.savedAt).toBe(FALLBACK);
  });
});