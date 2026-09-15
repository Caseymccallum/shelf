import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in jsdom rather than node because the capture routine's job is to transform a real
 * `Document`, and the interesting cases (shadow roots, `<template>`, canvas, lazy images) are DOM
 * facts, not string facts. The pure modules - the tokenizer, the index, the record format - do not
 * care either way.
 *
 * The URL matters: capture resolves every relative URL against the page it came from, so the tests
 * need a page URL that is not `about:blank`, and one origin that is clearly "same" and hosts that
 * are clearly "other".
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://example.test/article',
      },
    },
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
  },
});

