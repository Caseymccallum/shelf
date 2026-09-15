import { beforeEach, describe, expect, test } from 'vitest';
import { extractText } from './text';

/** Puts a fixture body in the global jsdom document and extracts its text. */
function textOf(body: string): string {
  document.body.innerHTML = body;
  return extractText(document.body);
}

describe('extractText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns one line per block', () => {
    expect(textOf('<h1>Title</h1><p>First paragraph.</p><p>Second.</p>')).toBe(
      ['Title', 'First paragraph.', 'Second.'].join('\n'),
    );
  });

  test('collapses source formatting inside a line', () => {
    expect(textOf('<p>one\n      two   three</p>')).toBe('one two three');
  });

  test('ignores scripts, styles, templates and vector graphics', () => {
    const body = `
      <p>kept</p>
      <script>var secret = 'not text';</script>
      <style>.a { color: red }</style>
      <template><p>not rendered</p></template>
      <noscript>not rendered</noscript>
      <svg><text>drawn</text></svg>
    `;
    expect(textOf(body)).toBe('kept');
  });

  test('ignores content hidden from readers', () => {
    const body = `
      <p>shown</p>
      <div hidden>hidden attribute</div>
      <div aria-hidden="true">hidden from assistive tech</div>
      <div style="display: none">display none</div>
      <div style="visibility:hidden">visibility hidden</div>
    `;
    expect(textOf(body)).toBe('shown');
  });

  test('keeps list items on their own lines', () => {
    expect(textOf('<ul><li>one</li><li>two</li></ul>')).toBe('one\ntwo');
  });

  test('treats a line break element as a break, not a space', () => {
    expect(textOf('<p>before<br>after</p>')).toBe('before\nafter');
  });

  test('reports nothing for an empty document', () => {
    expect(textOf('')).toBe('');
  });

  test('does not include the value of an input', () => {
    expect(textOf('<p>label</p><input value="typed">')).toBe('label');
  });
});
