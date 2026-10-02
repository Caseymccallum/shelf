# Privacy policy

**Shelf collects nothing. There is no server to collect it to.**

This is not a promise of restraint about what the product *could* gather - it is a description of
what the product is. Shelf has no account system, no analytics, no telemetry, no error reporting,
and no network code at all. The extension pages are forbidden from reaching the network
(`content_security_policy: script-src 'self'; object-src 'none'`), and a test asserts it.

## What is stored, and where

The archive - the pages you save and the search index beside them - lives in your browser's own
IndexedDB, on your machine. It is not transmitted anywhere. It leaves your machine only through an
export you make yourself, as a JSON file you then hold, copy or move.

## What is read

When you click Save, Shelf reads the page you are on - that one page, because the click granted
access to it (`activeTab`). It never reads pages you did not ask it to save: it declares no content
script and no host permissions.

## Third parties

None. There are no third-party services, no CDNs, no remote fonts or images. The extension is one
self-contained package.

## Changes

If this policy ever changes, it will be because the product changed - and the tests that pin the
permission list and the CSP would have had to change with it.

*Last updated: 2 October 2026.*
