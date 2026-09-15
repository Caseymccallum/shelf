/**
 * Turning numbers and timestamps into what a person reads.
 *
 * Shared by all three surfaces so the same archive is described the same way in the popup, the
 * library and the reader - and pure, so the wording is tested rather than eyeballed in whichever
 * page happened to be open.
 */

/** Bytes, at a scale a person can hold in their head: `8.4 MB` rather than `8808038`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;

  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below ten (1.4 MB), none above it (14 MB): precision that the reader would not use.
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit] ?? 'kB'}`;
}

/** `1 page` / `12 pages` - the count is the whole point of the line it appears in. */
export function formatCount(count: number): string {
  return count === 1 ? '1 page' : `${count.toLocaleString()} pages`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When something was saved, in the coarsest unit that is still useful.
 *
 * Recent things get relative wording, because "3 days ago" answers "is this the one I read this
 * week?" faster than a date does; older things get a date, because "412 days ago" answers nothing.
 */
export function formatDate(savedAt: number, now = Date.now()): string {
  const elapsed = now - savedAt;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return new Date(savedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The site a page came from: what a reader recognises faster than a full address. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
