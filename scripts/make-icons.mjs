/**
 * Draws Shelf's icons and store imagery, at every size the stores ask for.
 *
 * The mark: a bookmark, because that is what a saved page is. One shape, bold enough to survive at
 * 16 pixels, where detail is not lost so much as unreadable. Drawn as SVG and rasterised through the
 * browser Playwright already brings - the same renderer the extension is tested in - so the icons are
 * code in this repository rather than opaque binaries nobody can redraw, and the script that made
 * them is the one running now. The store tiles are drawn the same way, in the design system's paper
 * and ink (`src/ui/theme.css`), because a store tile is the listing's first sentence.
 *
 * Usage: node scripts/make-icons.mjs
 *   writes public/icons/icon-{16,32,48,128}.png
 *   and   store-assets/store-logo-300.png, store-assets/promo-tile-440x280.png
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const iconDir = join(root, 'public', 'icons');
const storeDir = join(root, 'store-assets');
const SIZES = [16, 32, 48, 128];

/**
 * The mark's shapes at their native 128 viewBox: a rounded field of Shelf blue, holding a white
 * bookmark. Shared by the icons and the store tiles so the mark cannot drift against itself.
 */
function markShapes() {
  return `<defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2d6cb5"/>
      <stop offset="1" stop-color="#1b4f8f"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#field)"/>
  <path d="M44 28a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v74l-20-15-20 15z" fill="#ffffff"/>`;
}

/** The mark at one size: a rounded field of Shelf blue, holding a white bookmark. */
function iconSvg(size) {
  // One viewBox of 128 for every size, so the shape is the same shape at every size - only the
  // rasteriser's business changes. Proportions chosen to leave the 16px mark readable.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  ${markShapes()}
</svg>`;
}

/**
 * The store logo (Edge asks for 300x300): the mark, on paper, full bleed - no transparency, so it
 * reads the same on any background the store puts behind it.
 */
function storeLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect width="300" height="300" fill="#f6f2ea"/>
  <g transform="translate(42 42) scale(1.6875)">${markShapes()}</g>
</svg>`;
}

/**
 * The small promotional tile (440x280): the mark, the name in the display serif, and the promise in
 * letterspaced small caps - the listing's first sentence, set the way the product sets its words.
 */
function promoTileSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#f6f2ea"/>
  <g transform="translate(40 84) scale(0.875)">${markShapes()}</g>
  <text x="184" y="134" font-family="'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif" font-size="48" fill="#2b2620">Shelf</text>
  <text x="186" y="170" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="13" letter-spacing="2.6" fill="#756b5c">SAVE ANY PAGE, FIND IT FOREVER</text>
</svg>`;
}

const browser = await chromium.launch();
try {
  mkdirSync(iconDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<!doctype html><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}</style>${iconSvg(size)}`,
    );
    // Omitting the page background keeps the field's rounded corners transparent, which is how an
    // icon should meet a browser's toolbar rather than arriving with a white box around it.
    await page.locator('svg').screenshot({ path: join(iconDir, `icon-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`public/icons/icon-${size}.png`);
  }

  // The store tiles: full bleed, so they sit on whatever ground the store draws behind them.
  for (const [name, width, height, svg] of [
    ['store-logo-300.png', 300, 300, storeLogoSvg()],
    ['promo-tile-440x280.png', 440, 280, promoTileSvg()],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<!doctype html><style>*{margin:0;padding:0}html,body{width:${width}px;height:${height}px}</style>${svg}`,
    );
    await page.locator('svg').screenshot({ path: join(storeDir, name) });
    await page.close();
    console.log(`store-assets/${name}`);
  }
} finally {
  await browser.close();
}