/**
 * The fixture site as a running server, and the log of everything it was asked for.
 *
 * The log is the point. "Shelf does not fetch other sites" and "opening an archive fetches nothing"
 * are claims about a browser's network activity, and the only way to test them honestly is to own the
 * server on the other end and count. A test can then say `expect(hits).toHaveLength(0)` and mean it.
 *
 * One server answers for two origins: `127.0.0.1` (the page's own origin) and `localhost` (a
 * genuinely different origin to a browser, even though the same process is behind it). That is what
 * makes "a file on another site was not saved locally" a real case rather than a mocked one.
 */

import { createServer, type Server } from 'node:http';
import { TINY_GIF, articleHtml, frameHtml, nextPageHtml, SHEET_CSS, REMOTE_CSS } from './fixtures';
import { FIXTURE_ORIGIN, FIXTURE_PORT, FIXTURE_REMOTE_ORIGIN } from './paths';

/** One request the fixture server answered. The unit of every privacy assertion in the harness. */
export interface FixtureHit {
  method: string;
  path: string;
  /** The host name the browser used, which is how "another site" is told apart from "the page". */
  host: string;
  /**
   * `Sec-Fetch-Dest`: `image` when an element asked for the file itself, `empty` when script did.
   *
   * This is what makes it possible to attribute a request. The live page loading its own images and the
   * capture reading them both arrive at the same server with the same path, and the only honest way to
   * tell them apart is what the browser says each request was for.
   */
  dest: string;
  at: number;
}

export interface FixtureSite {
  origin: string;
  remoteOrigin: string;
  /** A URL on the fixture site, for a test that needs to name one. */
  url(path: string): string;
  /** Every request so far, in arrival order. */
  hits(): FixtureHit[];
  /** Requests for one path, by either name, optionally only those of one kind. */
  hitsFor(path: string, dest?: string): FixtureHit[];
  /**
   * Requests the browser made on behalf of script, which is what a capture's reads look like.
   *
   * The distinction matters more than it sounds. A page loading its own images and Shelf reading those
   * images arrive at the same server with the same path; only the browser's own account of why a request
   * exists tells them apart, and counting both would make a test that cannot fail.
   */
  hitsByScript(): FixtureHit[];
  /** Requests that arrived by the other origin's name: the ones that mean something was fetched from
   *  a site that is not the page. */
  hitsFromOtherOrigin(): FixtureHit[];
  /** The distinct paths the other origin was asked for, sorted - readable in a failure message. */
  otherOriginPaths(): string[];
  /** Forgets everything so far. The only way to make a claim about *one phase* of a test. */
  clear(): void;
  stop(): Promise<void>;
}

interface Route {
  status: number;
  type: string;
  body: Buffer | string;
}

const HTML = (body: string): Route => ({ status: 200, type: 'text/html; charset=utf-8', body });
const NOT_FOUND: Route = { status: 404, type: 'text/plain; charset=utf-8', body: 'not here' };

/**
 * What the site serves.
 *
 * The image bytes are the same one-pixel GIF everywhere, whatever the extension: this fixture exists to
 * count requests and to prove what a capture can read, not to render a picture. `/remote-art.png` is
 * named only from the stylesheet on the other origin, which is precisely why it must never be fetched
 * during a capture.
 */
function routes(): Map<string, Route> {
  return new Map<string, Route>([
    ['/article', HTML(articleHtml())],
    ['/next', HTML(nextPageHtml())],
    ['/frame', HTML(frameHtml())],
    ['/redirected', HTML('<!doctype html><title>Redirected</title><p>The redirect fired.</p>')],
    ['/sheet.css', { status: 200, type: 'text/css; charset=utf-8', body: SHEET_CSS }],
    ['/remote.css', { status: 200, type: 'text/css; charset=utf-8', body: REMOTE_CSS }],
    ['/preload.js', { status: 200, type: 'text/javascript', body: 'window.__shelfPreloadRan = "ran";' }],
    ['/post', { status: 200, type: 'text/plain; charset=utf-8', body: 'posted' }],
    ['/local.gif', { status: 200, type: 'image/gif', body: TINY_GIF }],
    ['/canvas-source.gif', { status: 200, type: 'image/gif', body: TINY_GIF }],
    ['/track.gif', { status: 200, type: 'image/gif', body: TINY_GIF }],
    ['/hero-2x.png', { status: 200, type: 'image/png', body: TINY_GIF }],
    ['/poster.jpg', { status: 200, type: 'image/jpeg', body: TINY_GIF }],
    ['/clip.mp4', { status: 200, type: 'video/mp4', body: TINY_GIF }],
    ['/remote-art.png', { status: 200, type: 'image/png', body: TINY_GIF }],
    ['/missing.png', NOT_FOUND],
  ]);
}

/** Starts the fixture site, and keeps every request it answers. */
export async function startFixtureSite(): Promise<FixtureSite> {
  const routesByPath = routes();
  const hits: FixtureHit[] = [];

  const server: Server = createServer((request, response) => {
    const host = request.headers.host ?? 'unknown';
    const path = new URL(request.url ?? '/', `http://${host}`).pathname;
    const route = routesByPath.get(path) ?? NOT_FOUND;
    hits.push({
      method: request.method ?? 'GET',
      path,
      host,
      dest: String(request.headers['sec-fetch-dest'] ?? 'none'),
      at: Date.now(),
    });
    response.writeHead(route.status, {
      // Nothing here is cacheable: a second request must reach the server, or the log would lie.
      'content-type': route.type,
      'cache-control': 'no-store',
    });
    response.end(route.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Bound to every interface, so the same server answers as both 127.0.0.1 and localhost. It is a
    // fixture on a high port, alive only for the length of a test run.
    server.listen(FIXTURE_PORT, resolve);
  });

  /** The requests that arrived by the other origin's name: the ones that mean something left the page. */
  const otherOriginHits = (): FixtureHit[] => hits.filter((hit) => hit.host.startsWith('localhost'));

  return {
    origin: FIXTURE_ORIGIN,
    remoteOrigin: FIXTURE_REMOTE_ORIGIN,
    url: (path) => `${FIXTURE_ORIGIN}${path}`,
    hits: () => [...hits],
    hitsFor: (path, dest) =>
      hits.filter((hit) => hit.path === path && (dest === undefined || hit.dest === dest)),
    hitsByScript: () => hits.filter((hit) => hit.dest === 'empty'),
    hitsFromOtherOrigin: otherOriginHits,
    otherOriginPaths: () => [...new Set(otherOriginHits().map((hit) => hit.path))].sort(),
    clear: () => {
      hits.length = 0;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** The other origin's paths, as a set, for a test that wants to assert "only these". */
export function subsetOf(actual: string[], allowed: string[]): string[] {
  return actual.filter((path) => !allowed.includes(path));
}
