import { beforeEach, describe, expect, test } from 'vitest';
import { absolutiseUrls, flattenShadowRoots, stripExecutable } from './transform';

/** The page URL jsdom is configured with (see vitest.config.ts). */
const PAGE_URL = 'https://example.test/article';
const PAGE_ORIGIN = 'https://example.test';

/** Replaces the document's markup and returns the copy `captureDocument` would work on. */
function copyOf(source: string): HTMLElement {
  document.documentElement.innerHTML = `<head><title>Fixture</title></head><body>${source}</body>`;
  return document.documentElement.cloneNode(true) as HTMLElement;
}

beforeEach(() => {
  document.documentElement.innerHTML = '<head><title>Fixture</title></head><body></body>';
});

describe('stripExecutable', () => {
  test('removes scripts and the code inside them', () => {
    const copy = copyOf('<p>kept</p><script>alert(1)</script>');
    stripExecutable(copy);
    expect(copy.querySelector('script')).toBeNull();
    expect(copy.querySelector('body')?.textContent).toBe('kept');
  });

  test('removes the elements that only make sense while a page is loading', () => {
    const copy = copyOf(
      '<noscript>n</noscript><template><p>t</p></template><object></object><embed><base href="https://elsewhere.test/"><meta http-equiv="refresh" content="0">',
    );
    stripExecutable(copy);
    expect(copy.querySelector('noscript, template, object, embed, base, meta')).toBeNull();
  });

  test('removes inline event handlers', () => {
    const copy = copyOf('<a href="/x" onclick="steal()">x</a><img src="/i.png" onerror="alert(1)">');
    stripExecutable(copy);
    expect(copy.querySelector('a')?.getAttribute('onclick')).toBeNull();
    expect(copy.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  test('removes a javascript: link but keeps its text', () => {
    const copy = copyOf('<a href="javascript:alert(1)">click me</a>');
    stripExecutable(copy);
    expect(copy.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(copy.querySelector('a')?.textContent).toBe('click me');
  });

  test('replaces an embedded frame with a marker naming what is missing', () => {
    const copy = copyOf('<iframe src="https://widgets.other.test/embed"></iframe>');
    stripExecutable(copy);
    const marker = copy.querySelector('[data-shelf-skipped-frame]');
    expect(marker?.getAttribute('data-shelf-skipped-frame')).toBe('https://widgets.other.test/embed');
    expect(marker?.textContent).toBe('[embedded frame not saved]');
  });

  test('drops links that are not stylesheets, because they fetch while a document parses', () => {
    const copy = copyOf(
      '<link rel="preload" href="/font.woff2" as="font"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css">',
    );
    stripExecutable(copy);
    const links = Array.from(copy.querySelectorAll('link'));
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('rel')).toBe('stylesheet');
  });

  test('keeps ordinary content and harmless attributes untouched', () => {
    const copy = copyOf('<p class="lead" data-thing="1" style="color: red">hello</p>');
    stripExecutable(copy);
    expect(copy.querySelector('p')?.getAttribute('class')).toBe('lead');
    expect(copy.querySelector('p')?.getAttribute('data-thing')).toBe('1');
    expect(copy.querySelector('p')?.getAttribute('style')).toBe('color: red');
  });
});
