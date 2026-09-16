/**
 * The permission posture, asserted against the build that ships.
 *
 * This is the product decision in `wxt.config.ts` turned into a test. The install prompt is the first
 * thing a cautious person reads, and "read and change all your data on all websites" is the difference
 * between an audience that installs a reading archive and one that does not. A permission added for
 * convenience would be invisible in review and obvious in the prompt, so it is checked mechanically.
 *
 * No browser here: the artifact itself is the claim.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_HOST_PERMISSION, E2E_EXTENSION_DIR, PRODUCTION_EXTENSION_DIR } from './paths';

interface Manifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: unknown[];
  action?: { default_title?: string };
  content_security_policy?: { extension_pages?: string };
  [key: string]: unknown;
}

function readManifest(directory: string): Manifest {
  return JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Manifest;
}

test.describe('the extension that ships', () => {
  test('asks for the three permissions it needs, and nothing else', () => {
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'unlimitedStorage']);
  });

  test('has no host permissions at all, so it cannot read a page it was not asked to read', () => {
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toBeUndefined();
  });

  test('declares no content script, so an unsaved page never has Shelf in it', () => {
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain('capture.js');
  });

  test('forbids the extension pages themselves from reaching the network', () => {
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    expect(manifest.content_security_policy?.extension_pages).toContain("script-src 'self'");
    expect(manifest.content_security_policy?.extension_pages).toContain("object-src 'none'");
  });

  test('is one documented permission away from the extension the harness drives', () => {
    // The harness cannot click the browser's toolbar, so it adds a host permission for its own fixture
    // server. Naming the difference here keeps it from growing quietly: this is the only one.
    const shipped = readManifest(PRODUCTION_EXTENSION_DIR);
    const harnessed = readManifest(E2E_EXTENSION_DIR);
    expect(harnessed.host_permissions).toEqual([FIXTURE_HOST_PERMISSION]);
    expect(harnessed.permissions).toEqual(shipped.permissions);
  });
});
