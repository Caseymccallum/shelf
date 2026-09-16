/**
 * Getting an archive out of the browser, and getting one back in.
 *
 * Both directions are driven from this page rather than from the worker, because a download and a file
 * picker are things a page does and neither needs a permission Shelf does not already ask for. The
 * worker still owns the archive: it hands the export out a slice at a time, and it writes every page
 * an import brings in. Nothing here touches storage.
 *
 * The one thing worth knowing before reading on: a page's HTML passes through this document's memory
 * on its way to a file or out of one, because that is what a download is. Everything else - the walk
 * of the archive, the size of a message - is bounded by the batch size instead of by the library.
 */

import {
  MSG_EXPORT,
  MSG_IMPORT,
  ask,
  type ExportResponse,
  type ImportResponse,
} from '../../shared/messages';
import { TRANSFER_BATCH_SIZE, parseExport } from '../../core/export';
import { formatBytes, formatCount } from '../../ui/format';

/**
 * How long a blob URL is kept alive after the download starts.
 *
 * Revoking it immediately can pull the file out from under the browser, and keeping it for the life of
 * the page would hold an entire archive in memory until the tab closed.
 */
const BLOB_LIFETIME_MS = 10_000;

/** Hands a blob to the browser's downloads, with no `downloads` permission involved. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Attached before clicking: whether a detached anchor downloads anything is a browser behaviour, and
  // this is not worth betting a file on.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_LIFETIME_MS);
}

/**
 * Builds the export file and hands it to the browser.
 *
 * The whole archive is walked here rather than in the worker, so that no single message has to carry
 * a library. The fragments are designed to add up to exactly the file `core/export.ts` writes in one
 * piece - a header, then each run of entries with a comma between them, then the tail.
 */
export async function downloadArchive(): Promise<string> {
  const pieces: string[] = [];
  let offset = 0;
  let total = 0;
  let written = 0;
  let filename = 'shelf.json';
  let firstChunk = true;

  for (;;) {
    const batch = (await ask({ type: MSG_EXPORT, offset, limit: TRANSFER_BATCH_SIZE })) as ExportResponse;
    filename = batch.filename;
    total = batch.total;
    if (batch.header !== '') pieces.push(batch.header);
    if (batch.chunk !== '') {
      if (!firstChunk) pieces.push(',');
      pieces.push(batch.chunk);
      firstChunk = false;
    }
    if (batch.tail !== '') pieces.push(batch.tail);
    written += batch.entries;

    // Stop at the end of the archive, and also stop if a batch did not move: asking again with the same
    // offset would be asking the same question forever.
    if (batch.nextOffset <= offset || batch.nextOffset >= batch.total) break;
    offset = batch.nextOffset;
  }

  if (total === 0) return 'Nothing saved yet, so there is nothing to export.';

  const blob = new Blob(pieces, { type: 'application/json' });
  saveBlob(blob, filename);

  const exported = `Exported ${formatCount(written)} to ${filename} (${formatBytes(blob.size)}).`;
  // A page whose content is missing from the archive has nothing to put in a file. The count in the
  // envelope would then claim more than the file holds, so the file and the person are told.
  const shortfall =
    written < total ? ` Left out ${formatCount(total - written)} whose content is not in the archive.` : '';
  return `${exported}${shortfall}`;
}

/** How far an import has got, for a line that says so while it runs. */
export type ImportProgress = (done: number, total: number) => void;

/** What an import did, in the words a person would use. */
function importMessage(added: number, skipped: number, rekeyed: number, unreadable: number): string {
  const parts: string[] = [];

  if (added > 0) parts.push(`Added ${formatCount(added)}.`);
  if (skipped > 0) parts.push(`${formatCount(skipped)} already in your shelf.`);
  // Reported rather than corrected quietly: a file that says one thing about a page and contains
  // another is worth knowing about.
  if (rekeyed > 0) parts.push(`Re-keyed ${formatCount(rekeyed)}: the id in the file did not match the content.`);
  if (unreadable > 0) parts.push(`Left out ${formatCount(unreadable)} that could not be read.`);

  return parts.length === 0 ? 'That file had nothing in it to import.' : parts.join(' ');
}

/**
 * Reads an exported file and writes it into the archive.
 *
 * Parsed here, written in batches by the worker - which is what keeps a large import from having to
 * fit in one message - and re-importing a file that is already in the archive adds nothing, because a
 * page's identity is the hash of its content rather than the order it arrived in.
 */
export async function importArchive(file: File, onProgress?: ImportProgress): Promise<string> {
  const parsed = parseExport(await file.text());
  let added = 0;
  let skipped = 0;
  let rekeyed = 0;

  for (let start = 0; start < parsed.entries.length; start += TRANSFER_BATCH_SIZE) {
    const batch = parsed.entries.slice(start, start + TRANSFER_BATCH_SIZE);
    const response = (await ask({ type: MSG_IMPORT, entries: batch })) as ImportResponse;

    added += response.added;
    skipped += response.skipped;
    rekeyed += response.rekeyed;
    onProgress?.(Math.min(start + batch.length, parsed.entries.length), parsed.entries.length);
  }

  return importMessage(added, skipped, rekeyed, parsed.skipped);
}
