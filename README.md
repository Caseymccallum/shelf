# Shelf

**Save any page. Find it forever.** Shelf keeps a complete, readable copy of the page you are on - on
your machine, not on a server - and makes everything you have saved searchable in one place.

- **One click.** The page you are reading is saved as it looked, including the parts that usually do
  not survive a copy: the rendered DOM, the stylesheets, the images.
- **Instant local search.** Full text over everything you have saved, ranked, offline.
- **Read it offline.** Archived pages open in a sandboxed reader: no scripts run, nothing is fetched.
- **Yours.** No account, no sync service, no telemetry. The whole archive exports as one JSON file, and
  importing that file back is idempotent: the same file twice is the same library, not two.
- **Pocket refugees welcome.** Importers for other people's formats (Pocket exports, browser bookmarks,
  SingleFile) are the next piece of work; today the importer takes the files Shelf wrote.

## Status

Early, and deliberately so: the archive format, the capture routine and the search index are being
built first, together with the harness that proves them (`npm test`, `npm run test:e2e`).

## Why it exists

Read-it-later services die. Pocket was discontinued on 8 July 2025, after nineteen years, and took
its users' libraries with it. Bookmarks do not preserve anything - they rot. Every serious
alternative that keeps a *library* asks you to run a server (Linkwarden, Karakeep, Wallabag) or
trusts somebody else's cloud. Shelf's argument is that a library you cannot lose is a directory of
files you own, with a search index beside it.

## Development

```bash
npm install
npm run dev        # Chrome, with live reload
npm run verify     # typecheck, unit tests, build
npm run test:e2e   # saves real fixture pages in a real browser and reads them back
```

Documentation lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it is built and why,
including the decision record) and [`docs/FORMAT.md`](docs/FORMAT.md) (the archive format).

## Licence

MIT
