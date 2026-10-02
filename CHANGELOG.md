# Changelog

All notable changes to Shelf. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the versions move when behaviour a person could depend on changes - wording alone does not earn
a version.

## [0.1.0] - 2026-10-02

The first release - one honest record of the archive that ships, not a reconstruction of when each
part arrived.

### Added

- **Export just the pages picked.** A checkbox on every row, an `Export selected (N)` button that
  appears only when something is picked, and a select-all box that answers for the rows on screen.
  A pick outlives the row it was made on - a search that hides a page does not unpick it - and a
  deleted page is dropped quietly. The file is the same document an export of everything writes,
  with fewer pages in it: same envelope, same fragments, and an import needs no special case.
- **Other people's files come in as what they honestly are.** Pocket exports, browser bookmarks and
  saved pages (SingleFile) all import. Links arrive as links - the address, the title, the tags, and
  a warning that travels with the record - and saved pages arrive as content, cleaned the same way a
  live capture is. Identity is re-derived from the content, so a file cannot make the library
  describe a page incorrectly, and importing the same file twice adds nothing.
- **Save any page, find it forever.** The capture keeps the rendered DOM, stylesheets, images and
  canvas pixels - and leaves out everything that could run or navigate. Search is full text, ranked
  (BM25, phrases verified against the text), local and instant. The reader opens a saved page with
  no scripts and no fetches, fetching a missing file only when asked, and only that file. The whole
  archive exports as one JSON file that imports back idempotently.

### Changed

- **A design system, and the three surfaces rebuilt on it.** Warm paper, sepia ink, serif titles,
  hairline rules: the library reads like a catalogue, the popup like a date-due slip, and dark mode
  is ink rather than a grey inversion. All of it lives in `src/ui/theme.css` as named tokens - one
  source for colour, type, shape and motion, still self-contained (no web fonts, no remote images).
  Nothing about how the surfaces behave changed; `scripts/screenshots.mjs` shoots all three in both
  schemes, and those images are the store listing's screenshot set.

### Security

- The install prompt reads "read and change data on the site you're on" and not "all sites": Shelf
  asks for `activeTab`, never `<all_urls>`, declares no content script, and its extension pages are
  forbidden from reaching the network. The posture is not documentation - `manifest.spec.ts` asserts
  the shipped manifest, and fails the build if the list grows.
- Shadow-DOM flattening clones nodes instead of re-parsing HTML strings, so the capture that runs in
  a page never parses HTML at all - the property AMO's validator checks mechanically
  (`UNSAFE_VAR_ASSIGNMENT`), and a stronger promise than it asks for.
- The Firefox package declares `data_collection_permissions: { required: ['none'] }`, with minimum
  versions (140 desktop / 142 Android) that actually enforce the declaration.