/**
 * Preparing the extension the harness loads.
 *
 * The shipped build is not modified: it is copied, and the copy gets one extra permission. See
 * `paths.ts` for why that one difference exists, and `manifest.spec.ts` for the test that keeps the
 * shipped manifest clean.
 *
 * Skipped work is deliberate. If the build is missing, the harness says which command produces it
 * rather than failing three layers later with "the extension did not load".
 */

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_EXTENSION_DIR, FIXTURE_HOST_PERMISSION, PRODUCTION_EXTENSION_DIR } from './paths';

/** The fields of a manifest this setup touches, typed as loosely as the fact that it is JSON. */
interface BuiltManifest {
  permissions?: string[];
  host_permissions?: string[];
  [key: string]: unknown;
}

export default function globalSetup(): void {
  const shippedManifest = join(PRODUCTION_EXTENSION_DIR, 'manifest.json');
  if (!existsSync(shippedManifest)) {
    throw new Error(
      `No built extension at ${PRODUCTION_EXTENSION_DIR}. The harness runs against the real build, so run "npm run build" first ("npm run test:e2e" does).`,
    );
  }

  rmSync(E2E_EXTENSION_DIR, { recursive: true, force: true });
  cpSync(PRODUCTION_EXTENSION_DIR, E2E_EXTENSION_DIR, { recursive: true });

  const manifestPath = join(E2E_EXTENSION_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BuiltManifest;
  manifest.host_permissions = [...(manifest.host_permissions ?? []), FIXTURE_HOST_PERMISSION];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
