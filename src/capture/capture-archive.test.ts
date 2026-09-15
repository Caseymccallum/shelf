import { beforeEach, describe, expect, test } from 'vitest';
import { captureDocument, snapshotCanvases } from './transform';
import type { Fetcher } from './types';

const PAGE_URL = 'https://example.test/article';
const PAGE_ORIGIN = 'https://example.test';

function copyOf(source: string): HTMLElement {
  document.documentElement.innerHTML = `<head><title>Fixture</title></head><body>${source}</body>`;
  return document.documentElement.cloneNode(true) as HTMLElement;
}

function stubFetcher(files: Record<string, string>): Fetcher {
  return {
    async text(url) {
      return files[url] ?? null;
    },
    async dataUrl(url) {
      const value = files[url];
      return value === undefined ? null : { dataUrl: value, bytes: value.length };
    },
  };
}

beforeEach(() => {
  document.documentElement.innerHTML = '<head><title>Fixture</title></head><body></body>';
});

describe('snapshotCanvases', () => {
  test('replaces a canvas with the image it was showing', () => {
    const copy = copyOf('<canvas id="chart" class="plot"></canvas>');
    const live = document.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperty(live, 'toDataURL', { value: () => 'data:image/png;base64,CHART' });

    const warnings: string[] = [];
    expect(snapshotCanvases(document, copy, warnings)).toBe(1);

    const image = copy.querySelector('img');
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,CHART');
    expect(image?.getAttribute('data-shelf-canvas')).toBe('');
    expect(image?.getAttribute('class')).toBe('plot');
    expect(warnings).toEqual([]);
  });

  test('warns rather than throwing when a canvas cannot be read', () => {
    const copy = copyOf('<canvas></canvas>');
    const live = document.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperty(live, 'toDataURL', {
      value: () => {
        throw new Error('tainted');
      },
    });

    const warnings: string[] = [];
    expect(snapshotCanvases(document, copy, warnings)).toBe(0);
    expect(warnings.join(' ')).toContain('blank');
  });
});

describe('captureDocument', () => {
  test('archives a page with no scripts, a title, text and inlined bytes', async () => {
    document.documentElement.innerHTML = `<head><title>Reading list</title></head><body>
      <script>alert('gone')</script>
      <h1>Heading</h1><p>Body text here.</p>
      <img src="/a.png" onerror="steal()">
    </body>`;
    const fetcher = stubFetcher({ [`${PAGE_ORIGIN}/a.png`]: 'data:image/png;base64,AAA' });

    const result = await captureDocument(document, fetcher);

    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onerror');
    expect(result.html).toContain('data:image/png;base64,AAA');
    expect(result.text).toContain('Body text here.');
    expect(result.title).toBe('Reading list');
    expect(result.url).toBe(PAGE_URL);
    expect(result.warnings).toEqual([]);
  });

  test('detaches what it could not save, and says how many', async () => {
    document.documentElement.innerHTML = `<head><title>t</title></head><body>
      <img src="https://cdn.other.test/a.png">
      <img src="https://cdn.other.test/b.png">
      <link rel="stylesheet" href="https://cdn.other.test/s.css">
    </body>`;

    const result = await captureDocument(document, stubFetcher({}));

    expect(result.remoteResources).toBe(3);
    // `data-shelf-remote-src` contains the substring `src="http...`, so the assertion has to insist
    // on an attribute boundary - otherwise it passes on exactly the string it is meant to forbid.
    expect(result.html).not.toMatch(/\ssrc="https:\/\/cdn\.other\.test/);
    expect(result.html).toContain('data-shelf-remote-src="https://cdn.other.test/a.png"');
    expect(result.warnings.join(' ')).toContain('3 files on other sites');
  });

  test('leaves nothing live when resource inlining is switched off', async () => {
    document.documentElement.innerHTML = '<head><title>t</title></head><body><img src="/local.png"></body>';

    const result = await captureDocument(document, stubFetcher({}), { inlineResources: false });

    expect(result.html).toContain('data-shelf-remote-src');
    expect(result.html).not.toContain('src="/local.png"');
    expect(result.remoteResources).toBe(1);
  });
});
