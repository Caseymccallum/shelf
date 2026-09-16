/**
 * The fixture site: a page made out of everything a real page does that makes archiving hard.
 *
 * Every case here earns its place by being one of four things:
 *
 * - **a hazard**: a frame, a redirect, a preload, a `javascript:` link, a form that could post, a
 *   handler that would run. If one of these survives into the archive, a saved page stops being data.
 * - **a hard-to-capture truth**: a canvas whose pixels exist nowhere in the DOM, a shadow root that
 *   `cloneNode` skips, a lazy image, a second origin's stylesheet.
 * - **a fidelity check**: curly quotes, an em dash and non-Latin text, which a careless round trip
 *   through a reader or a store would mangle.
 * - **a measurement**: every path the fixture serves is logged, so "nothing left the browser" is a
 *   number rather than a promise.
 */

import { FIXTURE_ORIGIN, FIXTURE_REMOTE_ORIGIN } from './paths';

/** The words the fixture hangs its assertions on, named once so a test and the page cannot disagree. */
export const FIXTURE = {
  title: 'Notes on Durable Reading',
  /** Only ever in the visible body text: if search finds this, the text was indexed. */
  bodyWord: 'marginalia',
  /** Two adjacent words, for exact-phrase search. */
  phrase: 'luminous marginalia',
  /** Only ever in an `alt` attribute: an archive should not search what was never read out. */
  altOnlyWord: 'hoardbound',
  /** Only inside `<noscript>`, which is not what a reader with scripts saw. */
  noscriptWord: 'scribbledown',
  /** Only inside a `<script>`, which is never saved. */
  scriptWord: 'canaryscript',
  /** Text a careless round trip mangles. */
  unicode: '“curly quotes”, an em—dash, and 日本語',
} as const;

/** A one-pixel GIF: the smallest thing that is a real image to a browser. */
export const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The canvas the fixture paints, and so the size the archived image must have. */
export const CANVAS = { width: 40, height: 20 } as const;

/** The fixture's own stylesheet, inlined by the capture because it is on the page's own origin. */
export const SHEET_CSS = `.serif { font-family: Georgia, serif; line-height: 1.5 }
.note { border-left: 3px solid #c9a227; padding-left: 0.75rem }`;

/** A stylesheet on the other origin: it cannot be read, so it must survive as a record, switched off. */
export const REMOTE_CSS = `body { outline: 4px solid rebeccapurple }
.remote-only { background-image: url(/remote-art.png) }`;

/**
 * The page itself.
 *
 * The inline script has two jobs and both are load-bearing. It is the **control** for "no code runs":
 * it sets `window.__shelfRuntime`, so a test can prove the script really executed in the live page -
 * which is what makes its absence from the archive mean something. And it builds the two things a
 * DOM-only capture cannot see: the shadow root, and the canvas.
 *
 * The script sets its canary to `'drawn'` only after the canvas is painted, and waits for its source
 * image to load, so a test can wait for the page to be genuinely ready before saving it. Saving a page
 * mid-load is a real thing that happens, but it is not what this fixture is measuring.
 */
export function articleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="description" content="A fixture page for the Shelf end-to-end harness.">
  <meta http-equiv="refresh" content="3600;url=${FIXTURE_REMOTE_ORIGIN}/redirected">
  <title>${FIXTURE.title}</title>
  <link rel="stylesheet" href="/sheet.css">
  <link rel="stylesheet" href="${FIXTURE_REMOTE_ORIGIN}/remote.css">
  <link rel="preload" as="script" href="${FIXTURE_REMOTE_ORIGIN}/preload.js">
  <link rel="icon" href="/local.gif">
  <style>.own { color: #123456 }</style>
</head>
<body>
  <h1>${FIXTURE.title}</h1>
  <p class="serif" id="lede">The point of an archive is that it is still there later: ${FIXTURE.phrase}
  in the margin, kept for good. ${FIXTURE.unicode}.</p>
  <blockquote class="note">Nothing lasts unless it is readable offline.</blockquote>

  <p><img id="own" src="/local.gif" alt="a file the capture can save">
     <img id="remote" src="${FIXTURE_REMOTE_ORIGIN}/track.gif?case=src"
          srcset="${FIXTURE_REMOTE_ORIGIN}/track.gif?case=1x 1x, ${FIXTURE_REMOTE_ORIGIN}/hero-2x.png 2x"
          alt="a file the capture cannot save, and an alt carrying ${FIXTURE.altOnlyWord}">
     <img id="gone" src="/missing.png" alt="a file that is not there at all">
     <img id="inline" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="already inline">
     <img id="lazy" src="/local.gif" loading="lazy" alt="a lazy file"></p>

  <p id="render"><canvas id="chart" width="${CANVAS.width}" height="${CANVAS.height}"></canvas>
     <host-card></host-card></p>

  <video id="clip" preload="none" poster="${FIXTURE_REMOTE_ORIGIN}/poster.jpg" src="${FIXTURE_REMOTE_ORIGIN}/clip.mp4" controls></video>

  <p><a id="next" href="/next" onclick="window.__shelfHandlerRan = 'ran'">the next page</a>
     <a id="js" href="javascript:window.__shelfJavascriptRan = 'ran'">a link that is code</a></p>

  <form id="search" action="${FIXTURE_REMOTE_ORIGIN}/post" method="post">
    <input name="q" formaction="javascript:window.__shelfFormRan = 'ran'">
    <button type="submit">Search</button>
  </form>

  <iframe id="embedded" src="${FIXTURE_REMOTE_ORIGIN}/frame" title="an embedded frame"></iframe>
  <noscript>${FIXTURE.noscriptWord}</noscript>

  <script>
    // The control: proves this page's code ran, so its absence from the archive is evidence of something.
    window.__shelfRuntime = 'ran';
    // Seen by nobody, but a capture that kept script text would make this searchable.
    window.__shelfScriptWord = '${FIXTURE.scriptWord}';

    document.querySelector('host-card').attachShadow({ mode: 'open' }).innerHTML =
      '<p class="shadow-note">Shadow content that cloneNode would not copy.</p>';

    const tile = new Image();
    tile.onload = () => {
      const canvas = document.getElementById('chart');
      const context = canvas.getContext('2d');
      context.fillStyle = '#c9a227';
      context.fillRect(0, 0, ${CANVAS.width}, ${CANVAS.height});
      context.drawImage(tile, 0, 0);
      window.__shelfRuntime = 'drawn';
    };
    tile.src = '/canvas-source.gif';
  </script>
</body>
</html>
`;
}

/** A page behind a link, so the reader's "opens in a new tab" promise can be clicked. */
export function nextPageHtml(): string {
  return `<!doctype html><html><head><title>The next page</title></head>
<body><p>This page was fetched by someone who clicked.</p></body></html>`;
}

/** The page inside the embedded frame. It has no reason to load during a capture: any hit is a failure. */
export function frameHtml(): string {
  return `<!doctype html><html><head><title>A framed page</title></head>
<body><p>The frame's own page.</p></body></html>`;
}

/** The fixture's own origin, for a test that needs to name it. */
export const SAME_ORIGIN = FIXTURE_ORIGIN;

/** The second origin. Different name, same server, and a different origin to the browser. */
export const OTHER_ORIGIN = FIXTURE_REMOTE_ORIGIN;
