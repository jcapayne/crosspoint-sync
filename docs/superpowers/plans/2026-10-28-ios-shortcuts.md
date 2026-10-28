# Offline iOS Shortcuts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Track steps below.

**Goal:** Expose the app's cached books and clippings as read-only iOS Shortcuts entities.
**Architecture:** API cache writes publish a credential-free snapshot, serialized through a Tauri command to an atomic App Group file. Swift reads and filters it locally.
**Tech Stack:** React/JavaScript, Tauri/Rust, Swift App Intents (iOS 16).
**Spec:** docs/superpowers/specs/2026-10-28-ios-shortcuts-design.md

## Global Constraints

- Keep iOS 16 support; no extra dependencies or separate sync process.
- Preserve cache fetch timestamps offline; clear on logout and isolate accounts.
- Shortcuts never make network requests.

## Review Focus

- Late responses after logout must not restore data.
- Paginated failures must not publish a partial library.
- Offline launches must not claim freshly fetched data.
- Per-book clipping refreshes must remove deleted items for that book.
- Previously selected entities must not resolve against another account.

### Task 1: Publish the offline cache

Files: app/src/api.js; app/src/shortcutsCache.js; app/src/shortcutsCache.test.js; app/src/api.test.js; app/src/App.jsx; app/src-tauri/src/widget.rs; app/src-tauri/src/lib.rs.
Interface: syncShortcutsCache(session) mirrors existing local cache; update_shortcuts(json: Option<String>) atomically replaces or removes shortcuts.json.
- [x] Write failing tests for complete publication, offline freshness, per-book clippings, account clearing and delayed responses.
- [x] Run targeted tests and observe failure.
- [x] Implement cache bridge and native persistence; hydrate on launch, clear on sign-out.
- [x] Run app tests.

### Task 2: Native entities and actions

Files: app/src-tauri/gen/apple/Sources/crosspoint-sync-app/ShortcutsStore.swift; ReadingIntents.swift; Xcode project files; app/scripts/test-shortcuts.swift.
Interface: ShortcutsStore decodes snapshots; book/clipping entities use account-qualified IDs; actions return structured filtered entities.
- [x] Write failing Swift tests for decoding, filters, missing datasets and account identity.
- [x] Implement store, entities, Find Books, Get Book and Find Clippings; register sources with both Xcode project representations.
- [x] Run native store tests and available Swift/iOS compiler checks.

### Task 3: Verify and document

Files: app/README.md.
- [x] Document offline behavior, fields, example shortcut, cache population and device checks.
- [x] Run app suite/build, native tests, root suite and diff checks.
- [x] Review final diff for privacy, stale data and build integration; report SDK limitations.

Ruling: execute inline under the user's explicit implementation approval. Use a feature branch in the supplied checkout so the result remains directly reviewable; leave changes uncommitted.

## Verification record

- App suite: 239 tests passed across 21 files (`--maxWorkers=2`). An earlier default-concurrency run timed out in the existing Send deletion test; it passed individually and in the final full run.
- Server suite: 788 tests passed across 59 files after installing locked dependencies.
- App production build passed (existing large-chunk warning).
- Swift store: 10 checks passed; App Intents typecheck passed against macOS 13 deployment target using the installed Apple SDK.
- Standalone Rust persistence test passed, including replacement, failed-write preservation and repeated clearing.
- Xcode project plist validation and git diff whitespace checks passed.
- Full Cargo test unavailable offline: missing cached `anyhow` dependency. Follow-up verification located Xcode 27.1 with iOS 27.1 SDK. Native code passed iOS 16 device-target typechecking and an isolated Xcode iOS Simulator app build for arm64/x86_64. App Intents metadata extraction succeeded and includes FindBooksIntent, GetBookIntent and FindClippingsIntent. Full Tauri build and device runtime behavior remain unverified; the validation app deliberately excludes the Rust/WebView shell.
- Independent review: capped global clippings response could discard older complete per-book data; fixed with a regression test and reviewed again. Also covered legacy migration and late 404 fallback after sign-out.

Ruling: keep the requested `codex/ios-shortcuts` branch and leave changes uncommitted for review. No merge, push or publishing requested.
