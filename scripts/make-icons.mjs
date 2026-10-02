/**
 * Draws Shelf's icons, at every size the stores ask for.
 *
 * The mark: a bookmark, because that is what a saved page is. One shape, bold enough to survive at
 * 16 pixels, where detail is not lost so much as unreadable. Drawn as SVG and rasterised through the
 * browser Playwright already brings - the same renderer the extension is tested in - so the icons are
 * code in this repository rather than opaque binaries nobody can redraw, and the script that made
 * them is the one running now.
 *
 * Usage: node scripts/make-icons.mjs   (writes public/icons/icon-{16,32,48,128}.png)
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'public', 'icons');
const SIZES = [16, 32, 48, 128];

/** The mark at one size: a rounded field of Shelf blue, holding a white bookmark. */
function iconSvg(size) {
  // One viewBox of 128 for every size, so the shape is the same shape at every size - only the
  // rasteriser's business changes. Proportions chosen to leave the 16px mark readable.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2d6cb5"/>
      <stop offset="1" stop-color="#1b4f8f"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#field)"/>
  <path d="M44 28a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v74l-20-15-20 15z" fill="#ffffff"/>
</svg>`;
}

const browser = await chromium.launch();
try {
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}</style>${iconSvg(size)}`,
    );
    // Omitting the page background keeps the field's rounded corners transparent, which is how an
    // icon should meet a browser's toolbar rather than arriving with a white box around it.
    await page.locator('svg').screenshot({ path: join(outDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`public/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}