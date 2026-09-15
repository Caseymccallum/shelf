/**
 * The shape of one saved page, and the version of the format that produced it.
 *
 * Two copies of a page's content are kept, deliberately:
 *
 * - `html`  - the archived document, so the page can be re-rendered years later as it looked;
 * - `text`  - the visible text, so search works without re-parsing HTML and so a result can show
 *             the sentence that matched.
 *
 * The text copy is also what makes exact-phrase search honest: a phrase is verified against it
 * rather than trusted from an index of individual words.
 */

/**
 * Bumped whenever a change would alter how an already-stored record is read (fields added, fields
 * emptied, meaning changed). Stored on every record, so an archive written by an older Shelf can be
 * read - and migrated - by a newer one instead of being silently misread.
 */
export const FORMAT_VERSION = 1;

/** The metadata of one saved page. The archived HTML itself is stored beside it. */
export interface SavedPage {
  /**
   * The record's identity: the SHA-256 of the archived HTML. Saving the same page twice therefore
   * produces the same id, which is what makes deduplication and re-inlining possible later.
   */
  id: string;
  /** The page's address, normalised (fragment removed, tracking parameters kept as they were). */
  url: string;
  /** The page title as captured, trimmed, with a fallback derived from the URL. */
  title: string;
  /** When the user saved it (ms since epoch). */
  savedAt: number;
  /** Size of the archived HTML in bytes. */
  bytes: number;
  /** Visible words, used for length normalisation when ranking and shown in the library. */
  wordCount: number;
  /**
   * Anything the capture could not do - "4 images could not be saved", "an embedded frame was
   * skipped" - recorded rather than hidden, because a reader that quietly loses half a page is
   * worse than one that says so.
   */
  warnings: string[];
  /** The format version that produced this record. */
  formatVersion: number;
}

/** A page's archived content: the HTML and the text extracted from it. */
export interface PageContent {
  id: string;
  html: string;
  text: string;
}

/** What the library shows above the list: how much is in the archive, and how far it reaches back. */
export interface StatsSummary {
  /** Pages saved. */
  count: number;
  /** Total bytes of archived HTML. */
  bytes: number;
  /** The oldest saved page's timestamp, or null when the archive is empty. */
  oldest: number | null;
  /** The newest saved page's timestamp, or null when the archive is empty. */
  newest: number | null;
}

/** One search result: the record, its relevance, and why it matched. */
export interface SearchHit {
  page: SavedPage;
  score: number;
  /** The query terms this record actually contains, in query order. */
  matched: string[];
  /** The best sentence from `text` containing a term, for the result list. */
  snippet: string;
}
