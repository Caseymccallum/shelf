/**
 * The archive: where saved pages live, and how they are found again.
 *
 * Three object stores, because the three kinds of data have different shapes and different lifetimes:
 *
 * - `pages`    - the metadata, the visible text and the page's own token counts. Small rows, read on
 *                every search, so nothing large belongs here.
 * - `content`  - the archived HTML, which is big and is only read when a page is opened.
 * - `postings` - one row per token: which pages contain it and how often. Written on save, read on
 *                search; this is the index that makes search instant rather than a full scan.
 *
 * The token counts are stored on the page row as well as in the postings, which looks redundant and
 * is deliberate: deleting a page then costs one small read and a handful of writes instead of
 * scanning every posting in the archive, and the index can be rebuilt from the rows alone if the
 * format ever changes. Squeezing that out would be an optimisation that makes deletion O(archive).
 */

import type { ArchiveEntry } from '../core/export';
import { matchesPhrases, rank, snippetFor, type Postings } from '../core/search';
import { indexableTokens, parseQuery, tokenize } from '../core/tokens';
import type { PageContent, SavedPage, SearchHit, StatsSummary } from '../core/types';

export const DB_NAME = 'shelf';

/**
 * The database schema version, distinct from the record format version in `core/types.ts`. This one
 * changes when the *stores* change (a new store, a new index); the record version changes when the
 * meaning of a stored row changes. Keeping them apart means a record migration does not have to look
 * like a schema migration, and vice versa.
 */
export const DB_VERSION = 1;

const STORE_PAGES = 'pages';
const STORE_CONTENT = 'content';
const STORE_POSTINGS = 'postings';

/** A page row: the record the library reads, plus the two things only the archive needs. */
interface PageRow extends SavedPage {
  /** The visible text, kept so search can show a snippet without re-parsing the HTML. */
  text: string;
  /** This page's token frequencies, so a delete can undo exactly what a save added. */
  tokens: Record<string, number>;
}

interface PostingRow {
  token: string;
  docs: Record<string, number>;
}

/** Resolves when a request succeeds, rejects with the request's error otherwise. */
function fromRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Opens (and, on first run, creates) the archive. */
export function openArchive(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Idempotent rather than a `switch` on `request.oldVersion`: the version number decides *when*
      // an upgrade runs, but what it has to do is "make the stores that are missing exist". That is
      // both simpler to read and safe to re-run, and it does not depend on what a given engine
      // exposes during the upgrade - which is not the same everywhere. A future *destructive*
      // migration (changing a stored shape rather than adding a store) needs a marker in storage
      // rather than a guess from a version number, and goes here with a test that runs it twice.
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pages = db.createObjectStore(STORE_PAGES, { keyPath: 'id' });
        pages.createIndex('by-saved-at', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_CONTENT)) {
        db.createObjectStore(STORE_CONTENT, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_POSTINGS)) {
        const postings = db.createObjectStore(STORE_POSTINGS, { keyPath: 'token' });
        postings.createIndex('by-token', 'token');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the archive'));
  });
}

/**
 * Counts how often each token occurs: what a save adds to the index.
 *
 * Pure, and exported, because the index is only correct if this and the delete path agree - and an
 * index that disagrees with its pages is the one failure a user cannot see and cannot fix.
 */
export function countTokens(tokens: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of tokens) counts[token] = (counts[token] ?? 0) + 1;
  return counts;
}

/** Writes a page, its content and its index entries in one transaction - all of it, or none of it. */
export async function archivePage(input: {
  page: SavedPage;
  html: string;
  text: string;
}): Promise<SavedPage> {
  const tokens = countTokens(tokenize(input.text));
  const row: PageRow = { ...input.page, text: input.text, tokens };

  const db = await openArchive();
  try {
    const tx = db.transaction([STORE_PAGES, STORE_CONTENT, STORE_POSTINGS], 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('The archive transaction was aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('The archive transaction failed'));
    });

    tx.objectStore(STORE_PAGES).put(row);
    tx.objectStore(STORE_CONTENT).put({ id: input.page.id, html: input.html });

    // Merging into existing postings rather than overwriting them: a token row belongs to every page
    // that contains it, so the write has to be a read-modify-write inside this same transaction.
    const postings = tx.objectStore(STORE_POSTINGS);
    for (const [token, frequency] of Object.entries(tokens)) {
      const existing = await fromRequest<PostingRow | undefined>(postings.get(token));
      const docs = { ...(existing?.docs ?? {}), [input.page.id]: frequency };
      postings.put({ token, docs });
    }

    await done;
    return input.page;
  } finally {
    db.close();
  }
}

/** One page's record, or null when it is not in the archive. */
export async function getPage(id: string): Promise<SavedPage | null> {
  const db = await openArchive();
  try {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const row = await fromRequest<PageRow | undefined>(tx.objectStore(STORE_PAGES).get(id));
    return row === undefined ? null : toSavedPage(row);
  } finally {
    db.close();
  }
}

/** One page's content, or null when it is not in the archive. */
export async function getPageContent(id: string): Promise<PageContent | null> {
  const db = await openArchive();
  try {
    const tx = db.transaction([STORE_CONTENT, STORE_PAGES], 'readonly');
    const content = await fromRequest<PageContent | undefined>(tx.objectStore(STORE_CONTENT).get(id));
    const row = await fromRequest<PageRow | undefined>(tx.objectStore(STORE_PAGES).get(id));
    if (content === undefined || row === undefined) return null;
    return { id, html: content.html, text: row.text };
  } finally {
    db.close();
  }
}

/** Strips the archive's internal columns, so callers get exactly the record type they were promised. */
function toSavedPage(row: PageRow): SavedPage {
  const { text: _text, tokens: _tokens, ...page } = row;
  return page;
}

/** The most recently saved pages, newest first. */
export async function listPages(limit = 50, offset = 0): Promise<{ pages: SavedPage[]; total: number }> {
  const db = await openArchive();
  try {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const store = tx.objectStore(STORE_PAGES);
    const total = await fromRequest(store.count());
    const pages: SavedPage[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = store.index('by-saved-at').openCursor(null, 'prev');
      let skipped = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null || pages.length >= limit) {
          resolve();
          return;
        }
        if (skipped < offset) {
          skipped += 1;
          cursor.continue();
          return;
        }
        pages.push(toSavedPage(cursor.value as PageRow));
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the archive'));
    });

    return { pages, total };
  } finally {
    db.close();
  }
}

/**
 * Searches the archive.
 *
 * The index decides which pages *could* match; the stored text decides which actually do. That split
 * is what lets an exact phrase be honest: an index of single words cannot prove that three words
 * appeared in that order, so the phrase is verified against the page before a result is offered. A
 * search that quietly returns pages containing the words apart is worse than no search at all.
 */
export async function searchPages(
  query: string,
  limit = 50,
): Promise<{ hits: SearchHit[]; note?: string }> {
  const parsed = parseQuery(query);
  if (parsed.allStopWords) {
    return { hits: [], note: 'Every word in that search is a common one. Try something distinctive.' };
  }
  const tokens = indexableTokens(parsed);
  if (tokens.length === 0) return { hits: [], note: 'Type a word or two to search your archive.' };

  const db = await openArchive();
  try {
    const tx = db.transaction([STORE_POSTINGS, STORE_PAGES], 'readonly');
    const postingsStore = tx.objectStore(STORE_POSTINGS);
    const pagesStore = tx.objectStore(STORE_PAGES);

    const postings: Postings = {};
    const candidateIds = new Set<string>();
    for (const token of tokens) {
      const row = await fromRequest<PostingRow | undefined>(postingsStore.get(token));
      if (row === undefined) continue;
      postings[token] = row.docs;
      for (const id of Object.keys(row.docs)) candidateIds.add(id);
    }
    if (candidateIds.size === 0) {
      return { hits: [], note: 'Nothing in your archive mentions that.' };
    }

    const rows = new Map<string, PageRow>();
    const lengths: Record<string, number> = {};
    for (const id of candidateIds) {
      const row = await fromRequest<PageRow | undefined>(pagesStore.get(id));
      // A posting can outlive its page if a write was ever interrupted; skipping it here keeps a
      // search from offering a result that cannot be opened.
      if (row === undefined) continue;
      rows.set(id, row);
      lengths[id] = row.wordCount;
    }

    const total = await fromRequest(pagesStore.count());
    const needles = [...parsed.terms, ...parsed.phrases.flat()];
    const hits: SearchHit[] = [];

    for (const ranked of rank(parsed, postings, lengths, total)) {
      const row = rows.get(ranked.docId);
      if (row === undefined) continue;
      if (!matchesPhrases(row.text, parsed.phrases)) continue;
      hits.push({
        page: toSavedPage(row),
        score: ranked.score,
        matched: ranked.matched,
        snippet: snippetFor(row.text, needles),
      });
      if (hits.length >= limit) break;
    }

    const note = hits.length === 0 ? 'Those words are in your archive, but not together like that.' : undefined;
    return note === undefined ? { hits } : { hits, note };
  } finally {
    db.close();
  }
}

/** Removes a page, its content and its index entries. False when it was not there in the first place. */
export async function deletePage(id: string): Promise<boolean> {
  const db = await openArchive();
  try {
    const tx = db.transaction([STORE_PAGES, STORE_CONTENT, STORE_POSTINGS], 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('The delete transaction was aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('The delete transaction failed'));
    });

    const pages = tx.objectStore(STORE_PAGES);
    const row = await fromRequest<PageRow | undefined>(pages.get(id));

    if (row !== undefined) {
      pages.delete(id);
      tx.objectStore(STORE_CONTENT).delete(id);

      const postings = tx.objectStore(STORE_POSTINGS);
      // Only this page's own tokens are touched, which is the whole reason the row keeps its counts:
      // a delete costs a handful of writes instead of a scan of every posting in the archive.
      for (const token of Object.keys(row.tokens)) {
        const posting = await fromRequest<PostingRow | undefined>(postings.get(token));
        if (posting === undefined) continue;
        const docs = { ...posting.docs };
        delete docs[id];
        // A token row no page contains any more is noise the index would carry forever.
        if (Object.keys(docs).length === 0) postings.delete(token);
        else postings.put({ token, docs });
      }
    }

    await done;
    return row !== undefined;
  } finally {
    db.close();
  }
}

/** How much is in the archive, and how far back it reaches. */
export async function archiveStats(): Promise<StatsSummary> {
  const db = await openArchive();
  try {
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const store = tx.objectStore(STORE_PAGES);

    return await new Promise<StatsSummary>((resolve, reject) => {
      const stats: StatsSummary = { count: 0, bytes: 0, oldest: null, newest: null };
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) {
          resolve(stats);
          return;
        }
        const row = cursor.value as PageRow;
        stats.count += 1;
        stats.bytes += row.bytes;
        stats.oldest = stats.oldest === null ? row.savedAt : Math.min(stats.oldest, row.savedAt);
        stats.newest = stats.newest === null ? row.savedAt : Math.max(stats.newest, row.savedAt);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the archive'));
    });
  } finally {
    db.close();
  }
}

/**
 * A slice of the archive with its content, newest first - what an export is made of.
 *
 * Sliced rather than returned whole because a library is not guaranteed to fit in one message, and a
 * slice that fails is a slice that can be asked for again. `nextOffset` counts the *rows walked*
 * rather than the entries returned, so a row that cannot be exported cannot stall a caller in a loop.
 *
 * A page is read here in one piece - record, HTML and text - because that is what a file needs, and
 * because reading them together is what makes an export a page at a time rather than a full scan.
 */
export async function exportSlice(
  limit: number,
  offset: number,
): Promise<{ entries: ArchiveEntry[]; total: number; nextOffset: number }> {
  const db = await openArchive();
  try {
    const pagesTx = db.transaction(STORE_PAGES, 'readonly');
    const store = pagesTx.objectStore(STORE_PAGES);
    const total = await fromRequest(store.count());
    const rows: PageRow[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = store.index('by-saved-at').openCursor(null, 'prev');
      let skipped = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null || rows.length >= limit) {
          resolve();
          return;
        }
        if (skipped < offset) {
          skipped += 1;
          cursor.continue();
          return;
        }
        rows.push(cursor.value as PageRow);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the archive'));
    });

    const contentTx = db.transaction(STORE_CONTENT, 'readonly');
    const content = contentTx.objectStore(STORE_CONTENT);
    const entries: ArchiveEntry[] = [];

    for (const row of rows) {
      const stored = await fromRequest<PageContent | undefined>(content.get(row.id));
      // A row whose content is missing has nothing to write into a file. It is left out rather than
      // invented, and the caller can see the difference between what it walked and what it got, so an
      // export that is short of pages can say so instead of claiming a count it does not hold.
      if (stored === undefined) continue;
      entries.push({ page: toSavedPage(row), html: stored.html, text: row.text });
    }

    return { entries, total, nextOffset: Math.min(offset + rows.length, total) };
  } finally {
    db.close();
  }
}

/** What an import did. */
export interface ImportCounts {
  /** Entries written to the archive. */
  added: number;
  /** Entries that were already there - importing the same file twice is not a duplication. */
  skipped: number;
}

/**
 * Writes entries that came from a file.
 *
 * Every entry goes through the same path a save does, which is the point: the index is rebuilt from
 * the entry's own text rather than trusted from the file, so an export carries no index at all and an
 * imported page is findable the moment it lands. One entry is one transaction, for the same reason a
 * save is - there is no state where a page exists and its index entries do not.
 */
export async function importPages(entries: readonly ArchiveEntry[]): Promise<ImportCounts> {
  const counts: ImportCounts = { added: 0, skipped: 0 };

  for (const entry of entries) {
    const existing = await getPage(entry.page.id);
    if (existing !== null) {
      counts.skipped += 1;
      continue;
    }
    await archivePage({ page: entry.page, html: entry.html, text: entry.text });
    counts.added += 1;
  }

  return counts;
}


