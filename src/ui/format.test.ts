import { describe, expect, test } from 'vitest';
import { domainOf, formatBytes, formatCount, formatDate } from './format';

describe('formatBytes', () => {
  test('describes bytes below a kilobyte as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('shifts unit at each kilobyte boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 kB');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  test('drops the decimal once the number is large enough not to need it', () => {
    expect(formatBytes(9.5 * 1024)).toBe('9.5 kB');
    expect(formatBytes(14 * 1024)).toBe('14 kB');
  });
});

describe('formatCount', () => {
  test('says one page, not 1 pages', () => {
    expect(formatCount(1)).toBe('1 page');
  });

  test('pluralises everything else', () => {
    expect(formatCount(0)).toBe('0 pages');
    expect(formatCount(2)).toBe('2 pages');
  });
});

describe('formatDate', () => {
  const now = 1_700_000_000_000;

  test('describes the last minute as just now', () => {
    expect(formatDate(now - 30_000, now)).toBe('just now');
  });

  test('counts minutes, then hours, then days', () => {
    expect(formatDate(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatDate(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatDate(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });

  test('prefers yesterday to one days ago', () => {
    expect(formatDate(now - 86_400_000, now)).toBe('yesterday');
  });

  test('switches to a date once a week has passed', () => {
    const formatted = formatDate(now - 400 * 86_400_000, now);
    expect(formatted).not.toContain('ago');
    expect(formatted).toMatch(/\d{4}/);
  });

  test('does not claim the future for a clock that has drifted', () => {
    expect(formatDate(now + 5_000, now)).toBe('just now');
  });
});

describe('domainOf', () => {
  test('returns the hostname', () => {
    expect(domainOf('https://example.test/a/b?c=d')).toBe('example.test');
  });

  test('returns the input when it is not a URL', () => {
    expect(domainOf('not a url')).toBe('not a url');
  });
});
