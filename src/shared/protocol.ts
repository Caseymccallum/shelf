/**
 * The vocabulary of the message protocol: names, requests, responses.
 *
 * Deliberately free of any browser dependency, so the same names are used by the worker, the three
 * surfaces, and the end-to-end harness that drives them. A test that hardcodes `'shelf:search'` would
 * keep passing after a rename and prove nothing about the real protocol.
 */

import type { ArchiveEntry } from '../core/export';
import type { SavedPage, SearchHit, StatsSummary } from '../core/types';

export const MSG_SAVE_ACTIVE_TAB = 'shelf:save-active-tab';
export const MSG_LIST = 'shelf:list';
export const MSG_SEARCH = 'shelf:search';
export const MSG_GET_PAGE = 'shelf:get-page';
export const MSG_DELETE = 'shelf:delete';
export const MSG_STATS = 'shelf:stats';
export const MSG_EXPORT = 'shelf:export';
export const MSG_IMPORT = 'shelf:import';

/** Saving the page in the active tab. */
export interface SaveActiveTabRequest {
  type: typeof MSG_SAVE_ACTIVE_TAB;
}

export type SaveOutcome =
  /** Written to the archive. */
  | { status: 'saved'; page: SavedPage }
  /** Already in the archive, byte for byte - saving twice is not an error, and not a duplicate. */
  | { status: 'already-saved'; page: SavedPage }
  /** Nothing was written; `reason` is written for a person to read. */
  | { status: 'failed'; reason: string };

export interface SaveActiveTabResponse {
  type: typeof MSG_SAVE_ACTIVE_TAB;
  outcome: SaveOutcome;
}

export interface ListRequest {
  type: typeof MSG_LIST;
  limit?: number;
  offset?: number;
}

export interface ListResponse {
  type: typeof MSG_LIST;
  pages: SavedPage[];
  total: number;
}

export interface SearchRequest {
  type: typeof MSG_SEARCH;
  query: string;
  limit?: number;
}

export interface SearchResponse {
  type: typeof MSG_SEARCH;
  hits: SearchHit[];
  total: number;
  /** Set when the query could not be run at all, e.g. it was only stop words. */
  note?: string;
}

export interface GetPageRequest {
  type: typeof MSG_GET_PAGE;
  id: string;
}

export interface GetPageResponse {
  type: typeof MSG_GET_PAGE;
  page: SavedPage | null;
  html: string | null;
}

export interface DeleteRequest {
  type: typeof MSG_DELETE;
  id: string;
}

export interface DeleteResponse {
  type: typeof MSG_DELETE;
  deleted: boolean;
}

export interface StatsRequest {
  type: typeof MSG_STATS;
}

export interface StatsResponse {
  type: typeof MSG_STATS;
  stats: StatsSummary;
}

/**
 * One batch of an export.
 *
 * The document is sent in pieces rather than as one string because a library is not guaranteed to fit
 * in a message: the caller asks for a slice at a time and concatenates `header`, then each `chunk`
 * with a comma between them, then `tail`. The pieces are designed to add up to exactly the file
 * `core/export.ts` would have written in one go, and a unit test checks exactly that.
 */
export interface ExportRequest {
  type: typeof MSG_EXPORT;
  /** Where in the archive to start; the caller walks it one batch at a time. */
  offset?: number;
  limit?: number;
  /**
   * Export just these pages, by id, in the order given. Absent means the whole archive.
   *
   * This is a request about *which* pages, not a change to what an export is: a selected export is
   * the same document, written by the same fragments, and an import of it needs no special case.
   * The order is the caller's - the library passes newest first, as the whole-archive walk does.
   */
  only?: string[];
}

export interface ExportResponse {
  type: typeof MSG_EXPORT;
  /** The envelope and the opening of the entries. Empty on every batch after the first. */
  header: string;
  /** A run of entries, comma-separated. Empty only when the archive has nothing left to hand out. */
  chunk: string;
  /** How many entries this batch carried, so a caller can tell an empty archive from a short one. */
  entries: number;
  /** Closes the document. Empty until the batch that ends the walk. */
  tail: string;
  /** Where the next batch starts; equal to `total` when the archive has been walked. */
  nextOffset: number;
  /** Pages in the archive, so the caller knows how far it has to go. */
  total: number;
  /** What the file should be called. */
  filename: string;
}

export interface ImportRequest {
  type: typeof MSG_IMPORT;
  entries: ArchiveEntry[];
}

export interface ImportResponse {
  type: typeof MSG_IMPORT;
  added: number;
  skipped: number;
  /**
   * Entries whose stored id did not match the hash of their content, and which were therefore keyed by
   * the identity their content actually has. Reported rather than corrected quietly: a file that says
   * one thing about its pages and contains another is worth knowing about.
   */
  rekeyed: number;
}

export type ShelfRequest =
  | SaveActiveTabRequest
  | ListRequest
  | SearchRequest
  | GetPageRequest
  | DeleteRequest
  | StatsRequest
  | ExportRequest
  | ImportRequest;

export type ShelfResponse =
  | SaveActiveTabResponse
  | ListResponse
  | SearchResponse
  | GetPageResponse
  | DeleteResponse
  | StatsResponse
  | ExportResponse
  | ImportResponse;
