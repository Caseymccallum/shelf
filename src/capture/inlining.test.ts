import { beforeEach, describe, expect, test } from 'vitest';
import {
  detachRemoteReferences,
  inlineSameOriginImages,
  inlineSameOriginStylesheets,
  type InliningState,
} from './transform';
import type { Fetcher } from './types';

const PAGE_URL = 'https://example.test/article';
const PAGE_ORIGIN = 'https://example.test';

function copyOf(source: string): HTMLElement {
  document.documentElement.innerHTML = `<head><title>Fixture</title></head><body>${source}</body>`;
  return document.documentElement.cloneNode(true) as HTMLElement;
}

function state(overrides: Partial<InliningState> = {}): InliningState {
  return { remote: 0, maxResourceBytes: 1024, warnings: [], ...overrides };
}

/** A fetcher over a fixed set of URLs, so inlining can be tested without a network. */
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

describe('inlineSameOriginStylesheets', () => {
  test('replaces a same-origin link with inline CSS that resolves its own urls', async () => {
    const copy = copyOf('<link rel="stylesheet" href="/style.css">');
    const fetcher = stubFetcher({ [`${PAGE_ORIGIN}/style.css`]: 'body { background: url(bg.png) }' });
    await inlineSameOriginStylesheets(copy, PAGE_URL, fetcher, state());

    const style = copy.querySelector('style');
    expect(copy.querySelector('link')).toBeNull();
    expect(style?.getAttribute('data-shelf-from')).toBe(`${PAGE_ORIGIN}/style.css`);
    expect(style?.textContent).toContain(`url("${PAGE_ORIGIN}/bg.png")`);
  });

  test('warns when a same-origin stylesheet cannot be read', async () => {
    const copy = copyOf('<link rel="stylesheet" href="/missing.css">');
    const inlining = state();
    await inlineSameOriginStylesheets(copy, PAGE_URL, stubFetcher({}), inlining);
    expect(inlining.warnings.join(' ')).toContain('stylesheet');
  });

  test('leaves a cross-origin stylesheet for the detaching pass', async () => {
    const copy = copyOf('<link rel="stylesheet" href="https://cdn.other.test/a.css">');
    await inlineSameOriginStylesheets(copy, PAGE_URL, stubFetcher({}), state());
    expect(copy.querySelector('link')?.getAttribute('href')).toBe('https://cdn.other.test/a.css');
  });
});

describe('inlineSameOriginImages', () => {
  test('replaces a same-origin image with its bytes, even from a relative URL', async () => {
    const copy = copyOf('<img src="/a.png">');
    const fetcher = stubFetcher({ [`${PAGE_ORIGIN}/a.png`]: 'data:image/png;base64,AAA' });
    await inlineSameOriginImages(copy, PAGE_URL, fetcher, state());
    expect(copy.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAA');
  });

  test('refuses an image larger than the inline budget, and says so', async () => {
    const copy = copyOf(`<img src="${PAGE_ORIGIN}/big.png">`);
    const fetcher = stubFetcher({ [`${PAGE_ORIGIN}/big.png`]: 'x'.repeat(50) });
    const inlining = state({ maxResourceBytes: 10 });
    await inlineSameOriginImages(copy, PAGE_URL, fetcher, inlining);
    expect(copy.querySelector('img')?.getAttribute('src')).toBe(`${PAGE_ORIGIN}/big.png`);
    expect(inlining.warnings.join(' ')).toContain('not saved locally');
  });

  test('warns about an image it could not read', async () => {
    const copy = copyOf('<img src="/gone.png">');
    const inlining = state();
    await inlineSameOriginImages(copy, PAGE_URL, stubFetcher({}), inlining);
    expect(inlining.warnings.join(' ')).toContain('could not be saved');
  });

  test('leaves a cross-origin image for the detaching pass', async () => {
    const copy = copyOf('<img src="https://cdn.other.test/a.png">');
    await inlineSameOriginImages(copy, PAGE_URL, stubFetcher({}), state());
    expect(copy.querySelector('img')?.getAttribute('src')).toBe('https://cdn.other.test/a.png');
  });
});

describe('detachRemoteReferences', () => {
  test('makes a remote image inert and counts it', () => {
    const copy = copyOf('<img src="https://cdn.other.test/a.png">');
    expect(detachRemoteReferences(copy)).toBe(1);
    expect(copy.querySelector('img')?.hasAttribute('src')).toBe(false);
    expect(copy.querySelector('img')?.getAttribute('data-shelf-remote-src')).toBe('https://cdn.other.test/a.png');
  });

  test('disables a stylesheet that is still pointing at the network', () => {
    const copy = copyOf('<link rel="stylesheet" href="https://cdn.other.test/a.css">');
    expect(detachRemoteReferences(copy)).toBe(1);
    const link = copy.querySelector('link');
    expect(link?.hasAttribute('disabled')).toBe(true);
    expect(link?.getAttribute('data-shelf-remote-stylesheet')).toBe('https://cdn.other.test/a.css');
  });

  test('leaves a same-origin reference alone unless asked, then takes everything', () => {
    const copy = copyOf('<img src="/local.png">');
    expect(detachRemoteReferences(copy)).toBe(0);
    expect(detachRemoteReferences(copy, { includeSameOrigin: true })).toBe(1);
  });
});
