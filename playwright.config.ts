import { defineConfig } from '@playwright/test';

/**
 * The end-to-end harness: the real extension, in a real Chromium, against a site Shelf does not own.
 *
 * The unit tests prove the transform's rules against fixture documents. They cannot prove that those
 * rules survive contact with the browser that will actually run them: that a canvas really can be read
 * back, that a shadow root really is flattened, that a lazy image is fetched by the capture, or that
 * opening an archive really fetches nothing. Those are facts about a browser, so they need a browser.
 *
 * One worker, no parallelism. Every test drives one browser profile with one archive in it, and a test
 * that deleted a page while another test was reading it would be measuring the harness, not Shelf.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A cold Chromium launch with an extension, plus a build check, is slower than a unit test.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
