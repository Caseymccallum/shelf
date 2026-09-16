# The archive format

What Shelf writes, and what it promises never to write. This is the document to read before changing
anything that touches storage, because these are the facts a future version - or a different program
entirely - has to be able to rely on. A library you cannot lose is only worth having if its contents
are legible without the program that made them.

## Two versions, and why there are two

| Version | Where | Changes when |
| --- | --- | --- |
| `FORMAT_VERSION` = 1 | `src/core/types.ts`, stored on every record | the *meaning* of a stored row changes: a field added, a field repurposed, a field left empty that used to be filled |
| `DB_VERSION` = 1 | `src/storage/db.ts`, the IndexedDB schema | the *stores* change: a new object store, a new index, a store removed |

They are separate because the two kinds of change are separate. Adding a store does not change what a
record means, and changing what a record means does not require a new store. A migration that
conflates them has to be reasoned about twice: once as a schema change and once as a data change, with
no way to tell which half broke.

The rules that follow from that:

- **A record is never rewritten in place.** A page that has changed is a *different* record with a
  different id (see identity, below), so nothing has to guess whether yesterday's row is still valid.
- **Reading a record from an older format must still work.** A newer version of Shelf reads the stored
  `formatVersion` and migrates on read, rather than assuming it wrote what it is looking at.
- **A destructive migration is not a version bump.** Dropping a field or changing a stored shape is
  done by writing a marker into storage and migrating rows one at a time, because a version number
  decides *when* code runs, not *what has already been done*.
- **The schema upgrade is idempotent** ("make the missing stores exist") rather than a `switch` on
  `oldVersion`, because what the upgrade has to do is a fact about the stores, and every engine
  reports the upgrade differently. Running it twice has to be harmless, and there is a test that does.

## Where an archive lives

One IndexedDB database, `shelf`, in the extension's own origin. Nothing is written anywhere else: no
file on disk, no network, no other database. `unlimitedStorage` is requested because eviction of an
archive under storage pressure would break the product's only promise.

Three object stores, because the three kinds of data have different shapes and different lifetimes:

| Store | Key | Index | Read when |
| --- | --- | --- | --- |
| `pages` | `id` | `by-saved-at` on `savedAt` | every search, every list |
| `content` | `id` | - | a saved page is opened |
| `postings` | `token` | `by-token` on `token` | every search |

The split exists so a search never touches the archived HTML. Rows in `pages` are small and are read
in bulk to answer a query; `content` holds the bytes and is opened only for the one page being read.

**One save is one transaction**, across all three stores, and so is one delete. There is no
intermediate state where a page exists but its index entries do not: an index that disagrees with its
pages is the one failure a user cannot see and cannot fix.

## The record (`pages`)

A row is the `SavedPage` of `src/core/types.ts` plus two internal columns.

| Field | Meaning |
| --- | --- |
| `id` | **Identity: the SHA-256 of the archived HTML, as hex, truncated to the first 32 characters (128 bits).** Content, not address - see below. |
| `url` | The page's address as captured, with every URL resolved against it. Fragments were removed before saving. |
| `title` | The page's title, trimmed, with fallbacks: document title, then `<title>`, then the first `<h1>`, then the host name. Never empty. |
| `savedAt` | When the person saved it, in milliseconds since the epoch. |
| `bytes` | Size of the archived HTML in UTF-8 bytes - the number the library shows, not a file size on disk. |
| `wordCount` | The number of *indexed* tokens in the page's text, so the length normalisation used by ranking means the same thing here as it does in the index. |
| `warnings` | What the capture could not do, in sentences written for a person: images that could not be saved, a frame that was skipped, files left on other sites. |
| `formatVersion` | The `FORMAT_VERSION` that wrote this row. |
| `text` *(internal)* | The page's visible text, so a search result can show the sentence that matched without re-parsing 200 kB of HTML. |
| `tokens` *(internal)* | This page's own token frequencies: `{ token: count }`. |

The `text` and `tokens` columns are stored on the row deliberately, and the redundancy is the point:

- **Deleting a page stays cheap.** Undoing a page's contribution to the index needs to know exactly
  which tokens it touched. With `tokens` on the row, a delete costs one small read and a handful of
  writes; without it, a delete would scan every posting in the archive - making deletion O(archive)
  instead of O(page).
- **The index can be rebuilt from the rows alone.** `pages` plus `tokens` is enough to reconstruct
  `postings` completely, which is what makes a future format change survivable without an export.

### Identity is content, not address

`id` is the hash of the archived HTML. Two consequences, both intended:

- Saving the same article twice - from a newsletter, from a search result, from the same tab an hour
  later - produces *one* record, and the second save is reported as already saved rather than as a
  duplicate. Deduplication is not a feature bolted on; it falls out of what identity means.
- A page whose content changed since last time is a *different* record, and both are kept. An address
  is not a document, and treating it as one is how archives lose the version you actually read.

128 bits is far beyond collision territory for one person's reading and keeps keys short enough to sit
in a URL.

## The content (`content`)

One row per page: `{ id, html }`. The HTML is the archived document exactly as the capture wrote it. It
is never rewritten after the fact: the reader prepares a copy for display at read time, and the stored
bytes stay what was actually saved - which is what makes "this is what the page looked like" a claim
that can still be checked years later.

The text lives on the `pages` row rather than here, because search needs it without the HTML and the
reader needs the HTML without the text.

## The index (`postings`)

One row per token: `{ token, docs: { [pageId]: count } }`.

- **On save**, the page's text is tokenized, counted, and merged into the postings for each of its
  tokens - a read-modify-write inside the save transaction, because a token row belongs to every page
  containing that token.
- **On delete**, every token in the page's own `tokens` column has that page removed from its posting. A
  token row no page contains any more is deleted as well, so the index does not accumulate noise it
  would carry forever.
- **Document length** for ranking is the sum of a page's own token counts - the same number stored as
  `wordCount`, which is why it is stored at all.

The index is not a source of truth. It is a cache that can be rebuilt from `pages` and `content` alone,
and every search verifies what it claims against the page's own text (see below).

## The archived document

Every archive begins with `<!doctype html>` followed by the captured `<html>` element as the browser
serialised it. It is a *document*, not a file set: stylesheets and images are inline, and anything that
could not be inlined is a detached reference with its URL kept as data.

### Removed, always

| Removed | Why |
| --- | --- |
| `script`, `noscript`, `template` | Code, and content that only existed because code did not run. |
| `meta`, `base` | A meta refresh can navigate the reader away; a `base` changes what every relative link means. Every `<meta>` goes, which is why an archive carries no `charset` - the document is stored and re-rendered as a string, so its encoding is never in doubt. |
| `object`, `embed` | Plugin content: executable, unfetchable, impossible to make safe. |
| `link` that is not a stylesheet | `preload`, `prefetch`, `preconnect`, `icon` and `manifest` describe a page being *loaded*, and some of them fetch while a document parses. |
| `onload`, `onerror`, `onclick`, ..., `srcdoc`, `formaction` | Handlers, and attributes carrying a document or a URL that would act. |
| `integrity`, `nonce`, `crossorigin` | Meaningless once the resource is inline or gone. |
| `href` on a `javascript:` link | The link's text is kept; the code is not. |
| Every `iframe` and `frame` element | Replaced by a marker - see the vocabulary below. |

### Rewritten, so the archive does not depend on where it is rendered

- **URLs in elements**: `img[src|srcset]`, `source[src|srcset]`, `video[src|poster]`, `audio[src]`,
  `track[src]` and `input[src]` are resolved against the page they came from.
- **`a[href]`**: resolved as well - *except* fragments, which are left alone. In an archive `#section`
  means "jump inside the copy the reader is looking at"; resolved against the page, it would point at
  the live site.
- **CSS**: `url(...)` inside `<style>` elements and `style` attributes is resolved against the
  stylesheet or document it came from, so backgrounds and fonts do not silently retarget.

### Kept as a record: the `data-shelf-*` vocabulary

These attributes are the format's way of saying "this existed, and Shelf could not store it". The reader
is the only code that puts them back.

| Attribute | On | Value | Meaning |
| --- | --- | --- | --- |
| `data-shelf-remote-src` | `img`, `source`, `video`, `audio`, `track`, `input` | the URL | The file was not saved locally: it lives on another site, or a same-origin read failed. Inert, because an unknown attribute fetches nothing. |
| `data-shelf-remote-srcset` | `img`, `source` | the `srcset` list | The same, for a responsive candidate list. |
| `data-shelf-remote-poster` | `video` | the URL | The same, for a poster frame. |
| `data-shelf-remote-stylesheet` | `link[rel=stylesheet]` | the URL | A stylesheet that could not be read. The link keeps its `href` and gains `disabled`, because the browser has to be told not to use it - the one reference that cannot be detached by moving it. |
| `data-shelf-canvas` | `img` | empty | This `img` replaced a `<canvas>`, and its `src` is a `data:image/png` snapshot of what the canvas was showing. |
| `data-shelf-shadow-root` | `div` | the host's tag name | The wrapper holding a flattened shadow root, which `cloneNode` does not copy. |
| `data-shelf-from` | `style` | the URL | Where an inlined stylesheet came from. |
| `data-shelf-skipped-frame` | `div` | the frame's `src` | An embedded frame that could not be saved. Its text is the audience-facing `[embedded frame not saved]`. |

Two rules hold for every attribute above. The value is the original URL, never a rewritten one, so an
importer or exporter can work from it. And nothing in the vocabulary is something a browser acts on by
itself: an archive is inert with no reader at all - which is a test rather than a hope, because the
end-to-end harness loads the stored HTML as a bare document and requires it to fetch nothing.

## What the reader adds on top

The archive is already inert. The reader is the second lock on the same door, because "already inert" is
a claim about code that ran once, possibly years ago, possibly in an earlier version. Three things happen
at read time, and all three are about the reader's safety rather than the page's appearance.

**A policy is injected, forbidding the network by default:**

```
default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src data: blob:; base-uri 'none'; form-action 'none'
```

and, only after the reader explicitly asks for a page's unsaved files, the same policy with images,
styles, fonts and media allowed back from `https:` and `http:` - never scripts. `base-uri 'none'` and
`form-action 'none'` are the parts that matter most: a `base` cannot retarget the archive's links, and a
form cannot post anywhere, whatever markup survived.

**A refresh is removed.** No content-security directive stops a document navigating *itself*, so a
`<meta http-equiv="refresh">` could turn a saved page into the live one under the reader's feet. The
reader removes it and keeps any `charset`, which still governs how the page renders. This matters most
for markup Shelf did not write: an archive from an older version, or a file someone imported.

**Links to the web open in a new tab** (`target="_blank"`, `rel="noreferrer noopener"`), so clicking one
cannot replace the archive with the live page. Fragment links are left alone, because they point inside
the copy.

The reader's frame is sandboxed with `allow-popups allow-popups-to-escape-sandbox` and nothing else: no
scripts, no same-origin, no forms, plus `referrerpolicy="no-referrer"`. Opening an archive therefore
issues no requests at all - not to the page's own site, not to any site it mentioned. That is asserted by
counting them, not by hoping.

The number the reader states ("7 files were not saved locally") comes from the detached references in the
stored HTML: `data-shelf-remote-src`, `-srcset`, `-poster` and remote stylesheets. See the limits below
for what that number does *not* include.

## How search reads the format

**Words.** A word is a run of letters and digits, lower-cased, with apostrophes and internal hyphens kept
so `don't` and `state-of-the-art` stay whole. Single characters are dropped unless they are digits, so `a`
is noise but `5` is a version or a year. Thirty-five stop words are never indexed - a deliberately short
list, because aggressive ones break real queries and the ranking formula already discounts common words.

**Queries.** Quotes are the only syntax: `shelf "exact phrase" report` means both terms *and* the phrase,
in that order. Inside quotes, stop words are kept, because there the user is naming a sequence rather
than searching for words. A query whose every word is a stop word reports that it had nothing to look
for, rather than matching everything.

**Ranking.** BM25 with the standard constants (`k1 = 1.2`, `b = 0.75`), over the postings, normalised by
each page's own token counts. A page missing any required word is excluded rather than down-ranked -
someone who types two words means both - and equal scores break by id, so the order is stable.

**Phrases are verified against the page's text, never against the index.** An index of single words
cannot prove that three words appeared in that order, so a phrase is checked against the stored `text`
after ranking. When the words are all present but not in that order, the result carries a note saying so,
which is the difference between "no matches" and "no matches *like that*".

**Snippets** are the first line of `text` containing a matched word, centred on it and trimmed to 180
characters, so a result list can be judged without opening anything.

## Limits, stated

An archive that lies about what it saved is worse than one that admits it. These are the known ones, and
the ones this format does not yet solve:

- **Embedded frames are not saved.** Their contents belong to another document at another address, and
  copying them in would put someone else's page inside this archive under this page's address. A marker
  takes the frame's place, and the record carries a warning.
- **A canvas inside a shadow root is not paired**, so it appears blank. Pairing it would mean writing a
  marker into the live page to find it again, and Shelf does not modify the pages it reads.
- **The stated count of unsaved files is a floor, not a total.** A `url(...)` reference inside CSS - a
  background image, a font - is resolved but neither fetched nor counted, so it is silently absent from
  both the archive and the number the reader shows.
- **A detached `srcset` on its own is not counted** either: counts come from `src`, `poster` and remote
  stylesheets.
- **Fonts referenced from CSS are not saved**, because only images and stylesheets are read.
- **Media is not downloaded.** Video and audio keep their URLs and their poster only.
- **There is a 4 MB cap on an inlined image** (the default `maxResourceBytes`); anything larger is left
  remote and reported. Stylesheets are inlined without a cap.
- **The page is saved as it was, not as it would become.** Content that appears only after a scroll, a
  click, or a login the browser had not passed yet is not in the archive: what was rendered is saved.
- **No dynamic data is captured**: no websocket messages, no XHR responses, no form state, no scroll
  position.
- **History is by content, not by time.** Two saves of a changed page are two records; there is no
  timeline within a page, and no diff between versions.

## What an export will contain

Not built yet, and written down here because the format has to support it rather than be bent into it
later.

An export is one file holding, for each page, the record's own fields, the archived `html` and the
`text`, plus the `formatVersion` that wrote it. No index: `postings` is a cache, an importer rebuilds it
by tokenizing `text`, and shipping a cache in an exported file would create a second source of truth that
could disagree with the pages it came from.

That is the reason `text` is stored at all rather than derived on demand, and part of why identity is
content: an export followed by an import restores the same records under the same ids, so importing the
same file twice is idempotent rather than a duplication.

