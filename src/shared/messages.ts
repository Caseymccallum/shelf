/**
 * The message protocol between Shelf's surfaces.
 *
 * The popup, the library and the viewer all talk to the service worker rather than to the database
 * directly, for one reason: the capture happens in the worker's world (it injects into the page and
 * then writes the archive), and splitting the write path in two is how archives end up with an
 * index that disagrees with their contents.
 */

import { browser } from 'wxt/browser';
import type { SavedPage, SearchHit, StatsSummary } from '../core/types';

export const MSG_SAVE_ACTIVE_TAB = 'shelf:save-active-tab';
export const MSG_LIST = 'shelf:list';
export const MSG_SEARCH = 'shelf:search';
export const MSG_GET_PAGE = 'shelf:get-page';
export const MSG_DELETE = 'shelf:delete';
export const MSG_STATS = 'shelf:stats';

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

export type ShelfRequest =
  | SaveActiveTabRequest
  | ListRequest
  | SearchRequest
  | GetPageRequest
  | DeleteRequest
  | StatsRequest;

export type ShelfResponse =
  | SaveActiveTabResponse
  | ListResponse
  | SearchResponse
  | GetPageResponse
  | DeleteResponse
  | StatsResponse;

/** Sends a request and fails loudly if the worker answers with an error instead of a shape. */
export async function ask(request: ShelfRequest): Promise<ShelfResponse> {
  return (await browser.runtime.sendMessage(request)) as ShelfResponse;
}
