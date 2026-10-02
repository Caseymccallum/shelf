/**
 * Puts the finished surfaces on screen: the real extension, in a real browser, saved as images.
 *
 * Two jobs. It is how a design change is *looked at* rather than merely tested - the tests say the
 * rules hold, this says what they look like. And the output is the store listing's screenshot set,
 * so the pictures that go to a store are the product rather than a drawing of it.
 *
 * Usage: npm run build, then node scripts/screenshots.mjs   (writes .tmp/screenshots/)
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, '.tmp', 'screenshots');
const extensionDir = join(root, '.output', 'chrome-mv3');

/** Fills a page with enough real text that the archive's honest byte counts look like pages. */
function prose(topic, words) {
  const sentence = `${topic} is the kind of thing that only becomes obvious once you have kept it for a while. `;
  return sentence.repeat(Math.ceil(words / 18));
}

/** The archive to put on screen: ordinary pages with ordinary titles and honest metadata. */
function sample(id, url, title, savedAt, topic, words, warnings = []) {
  const body = prose(topic, words);
  return {
    page: {
      id,
      url,
      title,
      savedAt,
      bytes: 0,
      wordCount: 0,
      warnings,
      formatVersion: 1,
    },
    html: `<article><h1>${title}</h1><p>${body}</p></article>`,
    text: body,
  };
}

const SAMPLE = [
  sample(
    'a1',
    'https://example.test/the-quiet-web',
    'The Quiet Web',
    Date.now() - 2 * 60 * 60 * 1000,
    'The quiet web',
    1840,
  ),
  sample(
    'a2',
    'https://library.example.org/notes-on-keeping',
    'Notes on Keeping Things',
    Date.now() - 26 * 60 * 60 * 1000,
    'Keeping things',
    903,
    ['an embedded frame was skipped'],
  ),
  sample(
    'a3',
    'https://blog.example.net/type-matters',
    'Type Matters More Than You Think',
    Date.now() - 9 * 24 * 60 * 60 * 1000,
    'Good typography',
    2412,
  ),
];

/** The one browser API this script touches: the extension's own message port. */

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const at = (path) => `chrome-extension://${extensionId}/${path}`;

  // Seed the archive through the same message the import path uses - and then ask what the pages
  // became. Identity is derived from content, so the ids in the sample are claims the import
  // re-keys; the viewer is shot with the id the archive actually gave the page.
  const seed = await context.newPage();
  await seed.goto(at('library.html'), { waitUntil: 'domcontentloaded' });
  await seed.evaluate(async (samples) => {
    await globalThis.chrome.runtime.sendMessage({ type: 'shelf:import', entries: samples });
  }, SAMPLE);
  const byTitle = await seed.evaluate(async () => {
    const list = await globalThis.chrome.runtime.sendMessage({ type: 'shelf:list', limit: 100 });
    return list.pages.map((p) => [p.title, p.id]);
  });
  await seed.close();
  const readerId = byTitle.find(([title]) => title === 'Notes on Keeping Things')?.[1] ?? '';

  for (const scheme of ['light', 'dark']) {
    const shots = [
      ['library', 'library.html'],
      ['viewer', `viewer.html?id=${readerId}`],
    ];
    for (const [name, path] of shots) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(at(path), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500); // rows settle in; let them arrive before the shutter
      await page.screenshot({ path: join(outDir, `${name}-${scheme}.png`) });
      await page.close();
    }

    // The popup is a small piece of paper: shot at its own size, not adrift in a browser page.
    const popup = await context.newPage({ viewport: { width: 360, height: 300 } });
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.goto(at('popup.html'), { waitUntil: 'domcontentloaded' });
    await popup.waitForTimeout(300);
    await popup.locator('.popup').screenshot({ path: join(outDir, `popup-${scheme}.png`) });
    await popup.close();
  }

  console.log(`screenshots in ${outDir}`);
} finally {
  await context.close();
}