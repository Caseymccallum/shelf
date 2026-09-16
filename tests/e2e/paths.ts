/**
 * Where the end-to-end harness keeps things, and the one fixture address it needs.
 *
 * A fixed port rather than an ephemeral one: the extra host permission the harness adds to its copy
 * of the built extension has to name the origin before the browser starts, so the port cannot be
 * discovered at run time. Picking a high, uncommon port keeps that cheap.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository root, so every path below is absolute and independent of the working directory. */
export const ROOT = resolve(HERE, '..', '..');

/** The shipped build, produced by `npm run build`. Never modified by a test. */
export const PRODUCTION_EXTENSION_DIR = join(ROOT, '.output', 'chrome-mv3');

/** The copy the harness loads: the shipped build plus one permission (see `global-setup.ts`). */
export const E2E_EXTENSION_DIR = join(ROOT, '.output', 'e2e-extension');

/** The fixture site's port. */
export const FIXTURE_PORT = 31_789;

/** The page's own origin, as the browser sees it: the fixture site. */
export const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;

/**
 * The same server, reached by a different host name.
 *
 * `localhost` and `127.0.0.1` are different origins to a browser even when the same process answers
 * both, which is exactly what a fixture for "files Shelf could not save" needs: a real second origin,
 * with nothing else to stand up.
 */
export const FIXTURE_REMOTE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;

/**
 * The single, documented difference between the extension under test and the extension that ships.
 *
 * A real capture is authorised by `activeTab`, which the browser grants when a *person* invokes the
 * extension - clicking its toolbar button, or pressing a shortcut the browser handles above the page.
 * A test cannot click the browser's toolbar, so the harness copies the built extension and adds a host
 * permission for the fixture origin only, and `manifest.spec.ts` asserts that the shipped manifest has
 * no host permissions at all. The permission posture is therefore still enforced by a test - the
 * harness simply cannot pretend to have clicked.
 */
export const FIXTURE_HOST_PERMISSION = `${FIXTURE_ORIGIN}/*`;
