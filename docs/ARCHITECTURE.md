# How Shelf is built, and why

This is the decision record: what was chosen, what was rejected, and what the choice costs. The code
explains itself line by line; this document exists for the decisions that are only visible at a
distance - the ones a later change can quietly undo.

Shelf is one claim: *a library you cannot lose is a directory of files you own, with a search index
beside it.* Every decision below follows from taking that claim literally.

## The constraints that shape everything

1. **No server and no account.** Nothing is sent anywhere. The archive lives in the browser's own
   storage. The only network activity Shelf ever causes is (a) reading the page being saved, through
   that page's own credentials, and (b) files a reader explicitly asks for after being told what that
   means.
2. **The install prompt has to be readable.** A permission list is the first thing a cautious person
   reads, and `read and change all your data on all websites` costs an audience. So: `activeTab`,
   `scripting`, `unlimitedStorage` - and no host permissions, ever.
3. **A saved page must never execute.** An archive is data. Treating someone else's page as code years
   later is how an archive becomes an attack vector.
4. **The user must be able to leave.** Anything that cannot be exported is not really owned. So the
   format stores what an exporter needs (the record, the HTML, the visible text), the index is only ever
   a cache, and importing the exported file rebuilds it - a claim with a test behind it rather than a
   promise in a README.

## The pieces, and why each is a piece

| Module | What it owns | Why it is separate |
| --- | --- | --- |
| `src/core` | the record type and `FORMAT_VERSION`, the transfer format (`EXPORT_FORMAT`), tokenisation, ranking, text extraction | pure functions over plain objects; the same code runs in a unit test, the worker and a UI page |
| `src/capture` | the rules for turning a live document into an archive, plus the injection that runs them in a page | the rules are a pure function of a `Document` and a `Fetcher`, so they are provable in jsdom - and the injected shell stays tiny, because it runs in a page nobody controls |
| `src/entrypoints` | the worker, the injected shell, the three surfaces, and the transfer glue that drives a download and a file input | the worker is the only writer; a surface that wrote to the database directly is how an index ends up disagreeing with its pages |
| `src/storage/db.ts` | the three object stores, one transaction per save or delete | storage is one file so the invariant "the index agrees with the pages" has one place to be true |
| `src/ui` | `requireElement`, formatting, and `render-archive.ts` | the reader's preparation is the only code that interprets stored markup, and it is where the second lock lives |
| `src/shared` | the message vocabulary in `protocol.ts`, the message helper in `messages.ts` | `protocol.ts` imports nothing at all, so the end-to-end harness names the same messages without pulling a browser into Node |
| `tests/e2e` | a real extension in a real Chromium, against a fixture site it owns | facts about a browser (canvas readback, shadow roots, what a network request is) cannot be tested any other way |

## The decisions

### 1. `activeTab` and on-demand injection, not a content script

*Chosen:* no declared content script. Clicking Save grants access to that one page, the worker injects
`capture.js` on demand, and the page you have not saved never has Shelf in it.

*Rejected:* a content script on `<all_urls>` that is always present. It would be faster and it would
ask for every site. It would also mean Shelf runs inside pages nobody asked it to run in, which is the
opposite of the product's argument.

*Cost:* capture cannot happen without a user action, so there is no background capture and no
"automatically save everything I read". This cost is real, and it is also why the permission list is
three entries long. It shows up in testing too: a test cannot click the browser's toolbar, so the e2e
harness adds one host permission to its *copy* of the build and asserts the shipped manifest has none.

### 2. Identity is the hash of the archived HTML, not the URL

*Chosen:* a page's id is the SHA-256 of its archived bytes, truncated to 128 bits.

*Rejected:* a URL, or a URL plus a timestamp. Identity by address cannot tell "the same article from
three newsletters" (three copies of one thing to read) from "the same address that changed" (two
different things worth keeping). Both of those are wrong in opposite directions, and a user cannot fix
either.

*Cost:* saving the same page again does all the work of capturing it before discovering it is already
there. That is the right trade: the alternative is a content check that has to trust a page's address,
and the capture is fast.

### 3. The capture is a pure function of a `Document` plus a `Fetcher`

*Chosen:* `captureDocument(doc, fetcher, options)` - everything about what survives into an archive is
decided by a function whose inputs are a DOM and a way to read bytes.

*Rejected:* doing the work inline in the injected script against `document`, with `fetch` called
directly. That version cannot be tested without a browser and a network, which in practice means it is
not tested, and the rules would live in the one file that runs inside somebody else's page.

*Cost:* the injected shell needs a bundle of the transform (`capture.js` is an unlisted script, injected
by file, never declared in the manifest), and the result crosses from the page to the worker through a
global that a second injection reads back. Both exist purely to keep the rules testable.

### 4. Nothing executable survives, and nothing remote stays live

*Chosen:* scripts, frames, `meta`, `base`, plugin content, inline handlers, `javascript:` addresses and
non-stylesheet `link`s are removed. Everything that would fetch is either inlined or moved into a
`data-shelf-remote-*` attribute - inert, because an unknown attribute fetches nothing - with the URL kept
as the value.

*Rejected:* keeping the markup and relying on the reader to neutralise it. That makes safety a property
of *the code that is running now* rather than of the stored bytes, so an archive keeps becoming unsafe
again every time the reader changes.

*Cost:* the archive is not a byte-for-byte copy of the page's source. It is the page as rendered, with
the parts that cannot be kept replaced by an honest record of them.

### 5. Same-origin files are inlined at capture time, not lazily later

*Chosen:* stylesheets and images on the page's own origin are read at capture time, through the page's
own `fetch` (so the page's own credentials and cookies apply), and stored inline.

*Rejected:* storing references and fetching them when the page is opened. That produces an archive that
needs the network and the site's permission to be readable - which is not an archive, and it is worse
than the bookmark it replaced, because it *looks* like it worked while the tab is still open.

*Cost:* a save takes as long as reading the page's files, and the stored HTML is much larger than the
source. There is a 4 MB cap on an inlined image; anything larger is left remote and reported.

### 6. The reader is a second lock, not the only one

*Chosen:* `render-archive.ts` prepares the stored markup for display by injecting a
content-security policy that forbids the network, removing a `meta refresh`, and making links to the web
open in a new tab. The frame is sandboxed with `allow-popups` and nothing else.

*Rejected:* trusting the capture, on the grounds that it already removed everything dangerous. The
capture is a claim about code that ran once, possibly years ago, possibly in an earlier version - and
soon, about files that came from somewhere else entirely. Two locks, because the failure mode is silent.

*Cost:* the reader has to know things about the format (which attributes to restore, which to remove),
and it is the only place where "an archive" and "a displayed archive" differ. That difference is stated
in `docs/FORMAT.md` so it cannot drift unnoticed.

### 7. Missing files are fetched only when the reader asks, per page

*Chosen:* the reader says how many files were not saved, and offers to load them; fetching uses a
relaxed policy that allows files but never scripts.

*Rejected:* fetching them silently when the page is opened, which would tell every origin that page
mentioned that you are looking at it, years after you looked at it - the exact surveillance the archive
exists to prevent.

*Cost:* some archives look incomplete until the reader acts. The count is a floor rather than a total
(see the format document's limits), which is deliberate: under-reporting invites the reader to ask,
over-reporting would mean counting things that were never fetched.

### 8. The service worker is the only writer

*Chosen:* the popup, library and viewer send messages; the worker performs every read and write.

*Rejected:* letting each surface talk to IndexedDB. The save path is a capture plus three writes and an
index update; splitting it means an archive whose index disagrees with its pages, which the user can see
(some searches silently find nothing) and cannot fix.

*Cost:* a save is a round trip through the worker, and every new capability is a message plus a handler.
The message vocabulary lives in `protocol.ts`, which imports nothing, so the harness and the surfaces
name the same messages - and the exhaustive `switch` in the worker is what fails when one is forgotten.

### 9. Three stores, and a page's token counts stored twice

*Chosen:* `pages` (small rows, read on every search), `content` (the archived bytes, read when a page is
opened), `postings` (token to pages and counts). A page row also keeps its own `tokens` map.

*Rejected:* one store, or a `postings`-only index. The duplicated counts exist so a delete can undo
exactly what a save added without scanning the index: with them, deleting is O(page); without, it is
O(archive). The redundancy also means the index is rebuildable from the rows alone, which is what makes a
future format change survivable.

### 10. The page's text is stored, not derived on demand

*Chosen:* `extractText` runs once at capture; the result is stored beside the record and indexed.

*Rejected:* re-extracting from the HTML when a result needs a snippet. That makes search cost a parse per
result, and it would index a *re-derivation* of the page rather than what was saved - so a change in the
extractor would silently change what an old archive matches.

*Cost:* the archive stores the page roughly twice, as markup and as text. The same text is also what an
export needs in order to rebuild the index, so it is doing two jobs.

### 11. BM25, with phrases verified against the text

*Chosen:* BM25 over an inverted index, every query term required, and any quoted phrase checked against
the stored text afterwards. A result where the words matched but not in that order comes back with a note
saying so.

*Rejected:* naive scoring, or trusting an index of single words for phrase queries. The first ranks badly
in exactly the case Shelf is for (a long archive, an unusual word); the second claims that three words
appeared in an order it cannot know.

*Cost:* a phrase search reads the text of every candidate page. That is fine at reading-library scale, and
it is the honest implementation of what a quoted query means.

### 12. Two test layers, chosen by what each fact is about

*Chosen:* **Vitest in jsdom** for everything that is a fact about the rules - what a document becomes,
what a token is, how results rank, what the reader prepares. **Playwright against real Chromium and the
real built extension** for everything that is a fact about a browser: that a canvas can be read back, that
a shadow root is flattened, that a lazy image is fetched, that opening an archive fetches nothing at all.

*Rejected:* one layer. jsdom cannot tell the truth about canvas pixels or layout, and a browser test
cannot cheaply cover the combinatorial rules of a DOM transform. The split is by kind, not by size.

*Cost:* the harness needs a fixture server, a temporary browser profile and a documented exception: it
copies the built extension and adds one host permission for its own fixture origin, because a real capture
is authorised by `activeTab` and a test cannot click the toolbar. The assertions in `manifest.spec.ts` are
the price of that exception, and they are worth more than it costs - the permission posture is enforced by
a test rather than described in a comment.

### 13. Small decisions that are still decisions

- **The library distinguishes empty from unmatched.** "Nothing saved yet" and "nothing matched" are
  different facts, and a search box that silently shows nothing is the most common way an archive feels
  broken when it is not. Escape clears the search rather than making someone select and delete.
- **Deleting is two clicks, with the second one named.** An archive is the kind of thing people regret
  losing. The library replaces the row's actions with a named confirmation and re-renders on either
  answer, so there is no state to get out of step; the reader renames its own button and deletes on the
  second click.
- **`requireElement` fails with the selector in it.** A missing element is a build-time mistake surfacing
  at run time, so the message says which one, once, instead of every caller writing a null check that
  TypeScript cannot carry into the closures below it.
- **Values from pages reach the document only through `textContent`.** A title, an address, a snippet and
  a warning all came from a page nobody here wrote; the DOM is built, never concatenated.
- **Firefox is the same code, and the differences are in the manifest.** One config produces both builds;
  what differs is `browser_specific_settings.gecko` and declaring `data_collection_permissions: none`.
  The two browsers also type `scripting` differently, which is why the one API the worker uses is declared
  locally rather than imported from either.

### 14. An export is a file, and identity is re-derived on import

*Chosen:* the library page walks the archive through the worker one slice at a time and assembles a single
JSON document - each record's own fields, the archived HTML, the stored text, and the versions that wrote
it - then hands it to the browser's own download as a blob. Import parses the file in the page and writes
it back in batches, because the worker is still the only writer. Neither direction needs a permission
Shelf does not already ask for.

*Rejected:* building the export in one message, and asking for `downloads` so the worker could write the
file itself. One message makes the largest possible library the largest possible message, which is a limit
that arrives as a failure rather than as a shape; a permission is a permanent cost paid for one button.

*Rejected:* believing the `id` in the file. An import hashes each entry's HTML, keys the record by that,
recomputes `bytes` and `wordCount` from the content, and reports how many entries it had to re-key. A file
is a claim; the content is the fact - and this is the same rule a save follows, not a second one.

*Rejected:* shipping the index. A `postings` table in a file would be a second source of truth that could
disagree with the pages it came from, so the importer rebuilds it by tokenizing the stored text. That is
what makes the promise "an export is the archive" true rather than approximate.

### 15. Other people's files come in through the same door, as what they honestly are

*Chosen:* Pocket exports, browser bookmarks and saved pages (SingleFile) all parse in `core/import.ts`
into the same entries the export format produces, and are written by the same worker in the same batches -
so content-derived identity, the rebuilt index and idempotent re-import hold for a file Shelf did not
write. A saved page is content, and is cleaned exactly as a live capture is (nothing executable survives,
URLs resolved before the page's base goes with it). A Pocket export and a bookmarks file hold addresses,
not pages; those become link-only records whose document is a small stub saying so, and whose warning
travels with the record into the library, the reader and any later export.

*Rejected:* fetching the pages a link points at during import. The import would silently phone home to
every site in a user's old library, from a file they have not read yet - the one thing Shelf's reader
offers only as an explicit, per-page choice.

*Rejected:* dropping Pocket links and bookmarks as "not real pages". The address is the one fact the file
genuinely knows, and search that can find the link is worth more than a library that refuses it. The stub
is what keeps that honest: the record claims a link, and says in its own document that the page itself
was not in the file.

*Cost:* the whole archive passes through the library page's memory on its way to a file or out of one, so
the export is the one operation whose ceiling is the browser rather than the archive. It is written down
as a limit in the format document instead of being discovered by whoever hits it.

*Cost:* one entry is one transaction, so importing a thousand pages is a thousand small writes. It is the
same path a save takes, which is the point: "the index agrees with the pages" has one implementation, and
it is the one that already has tests.

### 16. A picked export is the same file, with fewer pages in it

*Chosen:* exporting just the pages a reader ticked is the export walk narrowed to some ids - the same
fragments, the same envelope, the same `EXPORT_FORMAT` - so every Shelf that can read an export can read
this one, and the importer grows no new case. The pick lives in the library page, not the worker: which
pages a reader wants is a fact about their visit, not about the archive, so nothing is written down and
closing the library forgets it. Each batch names the ids again, because the worker remembers nothing
between batches by design - a batch that failed is still just a batch that can be asked for again.

*Rejected:* a second message type or a narrower `kind` for partial files. Two doors into the same room,
and every reader of the format would grow a case for a thing that is not different in any way that
matters.

*Cost:* the ids ride every batch, so a pick of a thousand pages is a thousand ids per message. The batch
size still bounds the entries, and this is the size of what a person ticked - a pick is not how one walks
a whole archive.

## How a change is verified

```bash
npm run compile    # types, including the harness
npm test           # the rules: the transform, tokenising, ranking, the reader's preparation
npm run build      # the extension, and the manifest the permission tests read
npm run test:e2e   # the browser facts, against a fixture site the harness owns
npm run verify     # compile + test + build: what should pass before a commit
```

| If you change | Also change |
| --- | --- |
| a stored field's meaning | `FORMAT_VERSION`, and the format document |
| the shape of an exported file | `EXPORT_FORMAT`, the format document, and the round-trip tests (`src/core/export.test.ts`, `tests/e2e/transfer.spec.ts`) |
| an object store or an index | `DB_VERSION`, with a migration that can run twice |
| a message | `protocol.ts`, the worker's `switch`, and a test that sends it |
| a rule in the reader | `render-archive.ts`, its unit tests, and the reader spec |
| a permission | `wxt.config.ts` and `manifest.spec.ts`, which asserts the exact list |
| what the capture keeps or drops | `transform.ts`, its tests, and the `data-shelf-*` table in the format document |

## What is deliberately not built yet

- **A streaming export.** The file is assembled in the library page, so its ceiling is what a browser will
  hold rather than what the archive can. Writing a file incrementally is not something a page can do
  without a permission Shelf does not want.
- **Storing a page's assets once and sharing them** between pages that used the same stylesheet. Today an
  archive duplicates what the page referenced; fixing it is a change to the format, not to the capture.
- **Sync, accounts, sharing, telemetry.** Not deferred: refused. The product's argument depends on none of
  them existing, and adding one would make the permission list a lie.
- **Reading a page that only exists behind a login**, or capturing what a page becomes after it changes
  itself. The capture is the moment; what is saved is what was there.


