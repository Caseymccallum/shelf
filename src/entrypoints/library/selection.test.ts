/**
 * What a reader picked, kept newest first whatever order they picked in.
 *
 * The order is the claim worth testing here: an export of some pages must be shaped like an export
 * of all of them, and that shape is "newest first" - so the ids have to come out ordered by when
 * each page was saved, not by when the reader happened to click.
 */
import { describe, expect, test, vi } from 'vitest';
import { createSelection } from './selection';

const pickedIn = (ids: [string, number][], onChange?: () => void) => {
  const selection = createSelection(onChange ?? (() => {}));
  for (const [id, savedAt] of ids) selection.toggle(id, true, savedAt);
  return selection;
};

describe('selection', () => {
  test('hands back ids newest first, whatever order they were picked in', () => {
    const selection = pickedIn([
      ['older', 100],
      ['newest', 300],
      ['middle', 200],
    ]);

    expect(selection.ids()).toEqual(['newest', 'middle', 'older']);
    expect(selection.count()).toBe(3);
  });

  test('unpicking removes, and picking the same page twice keeps one entry', () => {
    const selection = pickedIn([
      ['one', 100],
      ['two', 200],
    ]);

    selection.toggle('one', true, 100);
    expect(selection.ids()).toEqual(['two', 'one']);

    selection.toggle('two', false, 200);
    expect(selection.has('two')).toBe(false);
    expect(selection.ids()).toEqual(['one']);
  });

  test('a pick and a pick withdrawn are told to the listener; a page being forgotten is not', () => {
    const onChange = vi.fn();
    const selection = createSelection(onChange);

    selection.toggle('one', true, 100);
    selection.toggle('one', false, 100);
    expect(onChange).toHaveBeenCalledTimes(2);

    selection.toggle('two', true, 200);
    selection.forget('two');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(selection.count()).toBe(0);
  });
});
