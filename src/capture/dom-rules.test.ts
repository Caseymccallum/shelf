import { describe, expect, test } from 'vitest';
import { flattenShadowRoots, absolutiseUrls } from './transform';

const PAGE_URL = 'https://example.test/article';
const PAGE_ORIGIN = 'https://example.test';

function copyOf(source: string): HTMLElement {
  document.documentElement.innerHTML = `<head><title>Fixture</title></head><body>${source}</body>`;
  return document.documentElement.cloneNode(true) as HTMLElement;
}

describe('flattenShadowRoots', () => {
  test('moves shadow content into the host and records which component it came from', () => {
    const copy = copyOf('<my-card></my-card>');
    const host = document.querySelector('my-card') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>inside</p>';

    flattenShadowRoots(document.documentElement, copy, document);

    const wrapper = copy.querySelector('my-card [data-shelf-shadow-root]');
    expect(wrapper?.getAttribute('data-shelf-shadow-root')).toBe('my-card');
    expect(wrapper?.textContent).toBe('inside');
  });

  test('flattens nested shadow roots', () => {
    const copy = copyOf('<outer-box></outer-box>');
    const outer = document.querySelector('outer-box') as HTMLElement;
    const outerShadow = outer.attachShadow({ mode: 'open' });
    outerShadow.innerHTML = '<inner-box></inner-box>';
    const inner = outerShadow.querySelector('inner-box') as HTMLElement;
    inner.attachShadow({ mode: 'open' }).innerHTML = '<span>deep</span>';

    flattenShadowRoots(document.documentElement, copy, document);

    expect(copy.querySelector('[data-shelf-shadow-root="inner-box"]')?.textContent).toBe('deep');
  });

  test('keeps the light DOM children that were already there', () => {
    const copy = copyOf('<my-card><span>slot content</span></my-card>');
    const host = document.querySelector('my-card') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>shadow content</p>';

    flattenShadowRoots(document.documentElement, copy, document);

    const text = copy.querySelector('my-card')?.textContent ?? '';
    expect(text).toContain('slot content');
    expect(text).toContain('shadow content');
  });
});

describe('absolutiseUrls', () => {
  test('resolves relative image sources against the page they came from', () => {
    const copy = copyOf('<img src="/images/hero.png" srcset="/images/hero@2x.png 2x">');
    absolutiseUrls(copy, PAGE_URL);
    expect(copy.querySelector('img')?.getAttribute('src')).toBe(`${PAGE_ORIGIN}/images/hero.png`);
    expect(copy.querySelector('img')?.getAttribute('srcset')).toBe(`${PAGE_ORIGIN}/images/hero@2x.png 2x`);
  });

  test('resolves links without rewriting fragment or data URLs', () => {
    const copy = copyOf('<a href="/next">next</a><a href="#section">jump</a><img src="data:image/gif;base64,R0lGOD">');
    absolutiseUrls(copy, PAGE_URL);
    const anchors = Array.from(copy.querySelectorAll('a'));
    expect(anchors[0]?.getAttribute('href')).toBe(`${PAGE_ORIGIN}/next`);
    expect(anchors[1]?.getAttribute('href')).toBe('#section');
    expect(copy.querySelector('img')?.getAttribute('src')).toBe('data:image/gif;base64,R0lGOD');
  });

  test('resolves url() inside stylesheets but leaves data and fragment references alone', () => {
    const copy = copyOf(
      '<style>a { background: url("bg.png") } b { background: url(data:image/gif;base64,R0lGOD) } c { mask: url(#clip) }</style>',
    );
    absolutiseUrls(copy, PAGE_URL);
    const css = copy.querySelector('style')?.textContent ?? '';
    expect(css).toContain(`url("${PAGE_ORIGIN}/bg.png")`);
    expect(css).toContain('url(data:image/gif;base64,R0lGOD)');
    expect(css).toContain('url(#clip)');
  });

  test('resolves url() inside an inline style attribute', () => {
    const copy = copyOf('<div style="background-image: url(./photo.jpg)"></div>');
    absolutiseUrls(copy, PAGE_URL);
    expect(copy.querySelector('div')?.getAttribute('style')).toContain(`${PAGE_ORIGIN}/photo.jpg`);
  });
});
