import { describe, expect, test } from 'vitest';
import {
  READER_CSP,
  READER_CSP_WITH_REMOTE,
  countRemoteReferences,
  parseArchive,
  prepareArchiveForReading,
  restoreRemoteReferences,
} from './render-archive';

/** A miniature archive: one saved image, one that was left remote, one remote stylesheet. */
const ARCHIVE = `<!doctype html><html><head><title>Saved</title>
  <link rel="stylesheet" href="https://cdn.other.test/a.css" disabled data-shelf-remote-stylesheet="https://cdn.other.test/a.css">
  </head><body>
  <p>Kept text.</p>
  <img src="data:image/gif;base64,R0lGOD" alt="saved">
  <img data-shelf-remote-src="https://cdn.other.test/photo.png" alt="remote">
  <a href="https://example.test/next">next</a>
  <a href="#section">jump</a>
  </body></html>`;

describe('countRemoteReferences', () => {
  test('counts files that were not saved locally', () => {
    expect(countRemoteReferences(parseArchive(ARCHIVE))).toBe(2);
  });

  test('counts nothing when everything was saved', () => {
    expect(countRemoteReferences(parseArchive('<p>all local</p>'))).toBe(0);
  });
});

describe('prepareArchiveForReading', () => {
  test('forbids the network by default', () => {
    const prepared = prepareArchiveForReading(ARCHIVE);
    expect(prepared).toContain(READER_CSP);
    expect(prepared).not.toContain(READER_CSP_WITH_REMOTE);
  });

  test('does not put a remote reference back unless asked', () => {
    const prepared = prepareArchiveForReading(ARCHIVE);
    expect(prepared).not.toMatch(/\ssrc="https:\/\/cdn\.other\.test/);
    expect(prepared).toContain('data-shelf-remote-src');
  });

  test('allows the network only when the reader asks, and only for files', () => {
    const prepared = prepareArchiveForReading(ARCHIVE, { allowRemote: true });
    expect(prepared).toContain(READER_CSP_WITH_REMOTE);
    expect(prepared).toContain('src="https://cdn.other.test/photo.png"');
    expect(prepared).toContain('href="https://cdn.other.test/a.css"');
    // Scripts stay impossible either way: the reader can ask for files, never for code.
    expect(prepared).toContain("default-src 'none'");
    expect(prepared).not.toMatch(/script-src[^;]*unsafe/);
  });

  test('opens links in a new tab so the archive is not replaced', () => {
    const doc = parseArchive(prepareArchiveForReading(ARCHIVE));
    const external = doc.querySelector('a[href^="https"]');
    expect(external?.getAttribute('target')).toBe('_blank');
    expect(external?.getAttribute('rel')).toContain('noreferrer');
  });

  test('leaves a fragment link alone, because it points inside the archive', () => {
    const doc = parseArchive(prepareArchiveForReading(ARCHIVE));
    const fragment = doc.querySelector('a[href^="#"]');
    expect(fragment?.hasAttribute('target')).toBe(false);
  });

  test('removes a refresh that would navigate the reader away from the archive', () => {
    // The policy forbids the network, but it does not stop a document navigating itself - so an
    // archive that kept this could turn into the live page under the reader's feet. Only `refresh` is
    // removed; the policy itself is an `http-equiv` meta and has to stay.
    const prepared = prepareArchiveForReading(
      '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://live.test/article"></head><body>saved</body></html>',
    );
    expect(prepared).not.toMatch(/http-equiv="refresh"/i);
    expect(prepared).not.toContain('live.test');
    expect(prepared).toContain('Content-Security-Policy');
    expect(prepared).toContain('saved');
  });

  test('keeps a charset, because the encoding changes how the page renders', () => {
    const prepared = prepareArchiveForReading(
      '<!doctype html><html><head><meta charset="utf-8"></head><body>saved</body></html>',
    );
    expect(prepared).toContain('charset="utf-8"');
  });

  test('keeps the page that was saved, byte for byte, apart from the policy and the links', () => {
    const prepared = prepareArchiveForReading(ARCHIVE);
    expect(prepared).toContain('Kept text.');
    expect(prepared).toContain('data:image/gif;base64,R0lGOD');
  });
});

describe('restoreRemoteReferences', () => {
  test('reports how many references it put back', () => {
    const doc = parseArchive(ARCHIVE);
    expect(restoreRemoteReferences(doc)).toBe(2);
    expect(restoreRemoteReferences(doc)).toBe(0);
  });
});
