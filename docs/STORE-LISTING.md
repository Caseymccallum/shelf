# Store listing copy

The words that go next to Shelf in a store, kept here so the listing and the repository cannot
drift apart. Every claim in this file is one the test suite also makes somewhere.

## Summary (132 characters)

Save any page and find it forever. Local-first: nothing is sent to a server.

## Detailed description

Save the page you are reading - complete, readable and offline - and find it again years later.

- **One click saves the whole page.** The rendered page, its stylesheets, its images, the canvas as
  its pixels - and nothing that could run or navigate. What you saved cannot hurt you later.
- **Search everything you have kept.** Full text over your whole library, ranked, instant, offline.
- **Read it later - really later.** Saved pages open in a sandboxed reader: no scripts run, nothing
  is fetched, years from now, on a plane, after the site is gone.
- **Yours.** No account. No sync service. No telemetry. Your library is files on your machine, and
  it exports as one JSON file you can hold, copy or move.
- **Pocket refugees welcome.** Pocket exports, browser bookmarks and saved pages (SingleFile) all
  import - and they come in as what they honestly are, with the parts that were never in the file
  marked as missing rather than invented.

## Single purpose

"Save the page you are on, and find it again."

Shelf is a reading archive: it saves the page a person is looking at and searches what they saved.
That is the whole product - there is no service behind it, and the permission list is what a person
would guess from the purpose alone.

## Permission justifications

The install prompt is the first thing a cautious person reads, so the list is kept to three, and
`tests/e2e/manifest.spec.ts` fails the build if it grows.

- **`activeTab`** - to capture the page the person just clicked Save on. Access is granted by the
  click, to one page: not "all websites", not a standing grant.
- **`scripting`** - to inject the capture routine into that page on demand. Shelf declares no
  content script, so it is not present in pages that were never saved.
- **`unlimitedStorage`** - durability is the product's promise. An archive the browser may evict
  under storage pressure is not an archive. This does not widen what Shelf can read; it protects
  what a person already saved.

## Privacy

- Collects nothing. Sends nothing. There is no server to send it to.
- The extension pages themselves are forbidden from reaching the network
  (`content_security_policy`: `script-src 'self'; object-src 'none'`), and a test asserts it.
- The archive lives in the browser's IndexedDB. It leaves only through an export the person makes.

## Screenshots

`node scripts/screenshots.mjs` (after `npm run build`) shoots the real extension in a real browser:
the library, the reader and the popup, in light and dark, into `.tmp/screenshots/`. The pages are
seeded through the same import message the product uses, so what the store sees is the product -
1280x800 for the pages, the popup at its own size.

## Category

Productivity

## Language

English