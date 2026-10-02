import { defineConfig } from 'wxt';

/**
 * Shelf - save any page, find it forever.
 *
 * The permission list is the product decision that shapes this file. Shelf asks for `activeTab`,
 * not `<all_urls>`: clicking Save grants access to the page you are on, so the install prompt reads
 * "read and change data on the site you're on" rather than "all sites". For a product whose whole
 * argument is that it is safe to keep your reading in, that difference is the difference between a
 * mainstream audience and a security-reviewer audience.
 */
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'Shelf',
    short_name: 'Shelf',
    description: 'Save any page and find it forever. Local-first: nothing is sent to a server.',
    author: 'Casey McCallum',
    // `activeTab`        - capture the page you clicked on, and nothing else, ever.
    // `scripting`        - inject the capture routine on demand. There is no declared content
    //                      script, so Shelf is not present in pages you never saved.
    // `unlimitedStorage` - durability is the promise; the browser evicting an archive under
    //                      storage pressure would break it. This is the only permission here that
    //                      is not about a single click.
    permissions: ['activeTab', 'scripting', 'unlimitedStorage'],
    // The mark, at every size the browser and the stores ask for. Generated from
    // `scripts/make-icons.mjs`, which draws them as SVG and rasterises through Playwright - so the
    // icons are code in this repository rather than binaries nobody can redraw.
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'Save this page to Shelf',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    content_security_policy: {
      // Archived pages are rendered by an extension page, so the extension's own CSP applies to the
      // reader: no remote script, no remote object, no eval.
      extension_pages: "script-src 'self'; object-src 'none'",
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'shelf@caseymccallum.dev',
              strict_min_version: '115.0',
              // Explicitly declare that nothing is collected (Firefox 140+ manifest key).
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
