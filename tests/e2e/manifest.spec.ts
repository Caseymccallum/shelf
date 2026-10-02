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
  icons?: Record<string, string>;
  action?: { default_title?: string; default_icon?: Record<string, string> };
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

  test('wears its own face: the icons are declared, and the files are in the build', () => {
    // A build that references icons it did not ship shows a browser's grey placeholder in the
    // toolbar - the first thing anyone sees of Shelf. The manifest's claim and the files on disk
    // are checked together, because either one alone can be true while the other is not.
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    // Sorted as strings on both sides: keys come back from JSON in no order a person should trust.
    const expected = ['16', '32', '48', '128'].sort();
    expect(Object.keys(manifest.icons ?? {}).sort()).toEqual(expected);
    expect(Object.keys(manifest.action?.default_icon ?? {}).sort()).toEqual(expected);
    for (const size of expected) {
      expect(manifest.icons?.[size]).toBe(`icons/icon-${size}.png`);
      const icon = readFileSync(join(PRODUCTION_EXTENSION_DIR, `icons/icon-${size}.png`));
      // A PNG's first eight bytes are its signature: the file exists and is a PNG, not a stub.
      expect(icon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  test('its toolbar tooltip is the sentence, not the name', () => {
    // The tooltip is where the product says what it does before anyone clicks anything. The
    // manifest generator prefers the popup page's <title> to this config, so the claim is checked
    // against the build rather than against the config that lost the argument.
    const manifest = readManifest(PRODUCTION_EXTENSION_DIR);
    expect(manifest.action?.default_title).toBe('Save this page to Shelf');
  });
});
