# Changelog

All notable changes to Shelf. The format follows [Keep a Changelog](https://keepachangelog.com/),
and the versions move when behaviour a person could depend on changes - wording alone does not earn
a version.

## [Unreleased]

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

### Security

- The install prompt reads "read and change data on the site you're on" and not "all sites": Shelf
  asks for `activeTab`, never `<all_urls>`, declares no content script, and its extension pages are
  forbidden from reaching the network. The posture is not documentation - `manifest.spec.ts` asserts
  the shipped manifest, and fails the build if the list grows.

## [0.1.0] - 2026-09-15

### Added

- First working archive: capture, library, search, reader, and the harness that proves them
  (`npm test`, `npm run test:e2e` - the extension in a real browser, against a site Shelf does not
  own).