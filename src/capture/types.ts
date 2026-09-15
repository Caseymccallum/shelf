/**
 * The vocabulary of capturing a page.
 *
 * Kept separate from the transform itself so the injected shell (which runs in the page and must
 * stay tiny and dependency-free) and the tested core can share one vocabulary without either
 * importing the other's implementation.
 */

/** What a capture produced. */
export interface CaptureResult {
  /** The archived document, ready to be stored and re-rendered. */
  html: string;
  /** The page's visible text, which is what gets indexed. */
  text: string;
  title: string;
  url: string;
  /** Human-readable notes: what could not be saved, and why. Never silently dropped content. */
  warnings: string[];
  /**
   * References still pointing at the network (images, stylesheets on other origins). The reader
   * must not fetch these without asking, and the count is what it asks about.
   */
  remoteResources: number;
}

/** How much work the capture should do. */
export interface CaptureOptions {
  /**
   * Whether to fetch and inline resources that live on the page's own origin. Off makes capture
   * instant but produces a page that needs the network for its images.
   */
  inlineResources?: boolean;
  /** Largest resource to inline, in bytes. Bigger ones are left remote and reported. */
  maxResourceBytes?: number;
}

/**
 * How the transform gets bytes out of the page.
 *
 * Injected rather than called directly because resource fetching is the one part that cannot be
 * exercised in a unit test: in the page it is the page's own `fetch`, and in a test it is a stub
 * over fixture files. Everything else about the transform is a pure function of a Document.
 */
export interface Fetcher {
  /** The text of a URL, or null when it could not be read. */
  text(url: string): Promise<string | null>;
  /** The bytes of a URL as a data URL, or null when they could not be read. */
  dataUrl(url: string): Promise<{ dataUrl: string; bytes: number } | null>;
}

/** A rejection whose message is shown to a user as-is. */
export class CaptureRefused extends Error {}
