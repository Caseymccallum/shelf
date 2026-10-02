/**
 * Which pages a reader has picked.
 *
 * A selection is a fact about the reader's visit, not about the archive, so it lives in the library
 * rather than in the worker: nothing is written down, and closing the library forgets it. Each pick
 * remembers when its page was saved, so `ids()` can hand them over newest first - the same order an
 * export of the whole archive walks in, and so the same file shape whichever way it was made.
 */
export interface Selection {
  has(id: string): boolean;
  toggle(id: string, on: boolean, savedAt: number): void;
  /** Drops a page quietly - for one being deleted from the library. No notice: nothing was picked. */
  forget(id: string): void;
  ids(): string[];
  count(): number;
}

/** A selection that calls `onChange` whenever the reader is the one who changed it. */
export function createSelection(onChange: () => void): Selection {
  const picked = new Map<string, number>();

  return {
    has: (id) => picked.has(id),
    toggle(id, on, savedAt) {
      if (on) picked.set(id, savedAt);
      else picked.delete(id);
      onChange();
    },
    forget(id) {
      picked.delete(id);
    },
    // Sorted by when each page was saved, newest first. The sort is stable, so two pages saved in
    // the same tick stay in the order they were picked.
    ids: () =>
      [...picked.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id),
    count: () => picked.size,
  };
}
