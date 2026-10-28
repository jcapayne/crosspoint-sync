# CrossPoint Sync app

Companion app for a crosspoint-sync server: reading stats, currently reading, clippings per book,
and marking books reading / paused / finished / did not finish. It also browses OPDS catalogs
(Project Gutenberg built in; add Calibre, Kavita, Mayberry, or any OPDS 1.2/2.0 feed with no login,
a password, or a token), downloads books, and sends them to a CrossPoint over Wi-Fi via its File
Transfer server (`crosspoint.local`), optionally optimizing EPUBs before sending.

The OPDS client (`src-tauri/src/opds`) is ported from common-stacks. EPUB optimization runs a
[pinned copy of CrossPoint Reader's JavaScript optimizer](src/epub/vendor/README.md) in the app's
WebView: images fit the reader's screen in grayscale, SVG covers are fixed, and embedded fonts
are removed. The app detects X3/X4 through the reader's HTTP API. It uses normal optimization
mode; the reader's advanced crop/split/rotation controls are not exposed. Saved originals remain
unchanged, and optimization failures stop the send.

Downloads live in `~/Books/CrossPoint Sync` on desktop and in app storage on
phones. `cargo test -- --ignored` runs a live Gutenberg search-to-download check. Styled with the crosspoint-tools
design tokens (`src/index.css`).

Tauri 2 shell around a React + Tailwind UI, so one codebase builds for macOS, Windows, Linux,
iOS and Android (and runs as a plain web page with `npm run dev`). The UI calls the server's
`/api/v1` with the kosync credentials. Inside the app, requests go through the Tauri http plugin
(Rust side), so self-hosted servers work over plain `http://` on a LAN and regardless of the
server's `CORS_ORIGINS`. In a plain browser it falls back to `fetch` and needs CORS.

Sign in with **CrossPoint** (sync.crosspointreader.com) or **Self-hosted**: type `host:port` or a
full URL. Without a scheme it tries `https://` then `http://`, and only accepts a server that
answers `/healthz` like crosspoint-sync. The last server is remembered after signing out.

```sh
npm install
npm run dev                          # browser, http://localhost:1420
npm run tauri dev                    # desktop window
npm run tauri ios dev                # iOS simulator (needs Xcode)
npm run tauri android init && npm run tauri android dev
npm run tauri build                  # release desktop bundle
```

## iOS Shortcuts (iOS 16+)

The iOS build provides three read-only actions in Shortcuts under **CrossPoint Sync**:

- **Find Books**: optional reading-status and title/author filters. Returns books newest sync first.
- **Get Book**: select a book, or pass one from Find Books, to get its current saved details.
- **Find Clippings**: optional book, text (passage/note/chapter), and creation-date filters. Returns newest first.

Book results expose Title, Author, Reading Status, Progress (%) (0–100), Last Sync,
and Cached At. Clippings expose Text, Note, Chapter, Created At, Book, and Cached At.
For example: Find Books with Reading Status = Reading → Repeat with Each → get
Title, Progress (%) and Last Sync → append to a note. Use status Finished for a
finished-book list. Find Clippings → get Text can feed a quote collection.

Actions read the app's existing offline data through a credential-free snapshot in
the main app’s private Application Support storage. They do not contact the server or require the app's UI to
be open. Open the Library to save books; open Clippings to save the all-book list,
or an individual book to save its clippings. Only data the app has loaded is
available. The all-book clippings endpoint currently returns at most 5,000 items;
opening a book also saves its complete paginated clipping list. Unsynced reader
data cannot appear until the reader uploads it and the app refreshes.

**Last Sync** is the server's latest recorded progress update. **Cached At** is when
the app fetched the data; offline reads and restarts preserve it. Older caches may
have an unknown Cached At until refreshed online. Clippings can have different
cache times because books can refresh separately. Signing out clears the shared
snapshot; saved Shortcuts book selections are scoped to their server and account.
An uncached collection gives instructions to open the relevant app screen, while a
cached empty collection returns an empty list.

Native store checks (no simulator needed):

```sh
swiftc -module-cache-path /tmp/crosspoint-swift-cache \
  src-tauri/gen/apple/Sources/crosspoint-sync-app/ShortcutsStore.swift \
  scripts/shortcuts-tests/main.swift -o /tmp/crosspoint-shortcuts-tests
/tmp/crosspoint-shortcuts-tests
```

Before release, build/install using Xcode and verify all three actions appear in
Shortcuts. Load the Library and Clippings online, turn on airplane mode, close the
app and run each action; check the returned fields and unchanged Cached At. Sign
out and confirm actions no longer return the previous account's data. Sign into a
different account and verify a previously selected book cannot resolve to it.


## Building on a free Personal Team

Use the isolated Personal Team build instead of `ios:phone` (the latter uses the
official team's signing and IPA-export workflow). From the repository root:

```sh
npm run ios:personal:prepare --prefix app
open app/.ios-personal/src-tauri/gen/apple/crosspoint-sync-app.xcodeproj
```

In Xcode, select the **crosspoint-sync-app_iOS** target → **Signing & Capabilities**.
Enable **Automatically manage signing**, then select **your name (Personal Team)**.
If needed, add your Apple Account in Xcode Settings → Accounts. Xcode can create
an Apple Development certificate for you. You do not have to find or copy the
team ID: the next command reads the selection from this local project.

Connect/unlock your iPhone, enable Developer Mode, and run:

```sh
npm run ios:personal --prefix app
```

This bundles the frontend and opens Xcode. Keep the terminal command running,
select your iPhone as the run destination in Xcode, then click **Run** (⌘R).
Xcode signs and installs directly on the phone without an IPA export. The installed
app includes its frontend, so it can launch without a development server on your
Mac. Run the command again to rebuild after source changes; it refreshes the
isolated copy and preserves its bundle ID and selected team. Do not run
`tauri ios init` inside the local copy. To specify a known team ID without opening
Xcode, add `-- --team YOURTEAMID` to the prepare command.

The generated app, signing settings and unique bundle identifier live under
`app/.ios-personal/` (ignored by Git). Official release files remain unchanged.
Personal builds omit the home-screen widget and Universal Links used by some
connector sign-in callbacks. The library and offline Shortcuts actions work using
private app storage, without an App Group entitlement. Free provisioning expires
periodically; rerun the development command when the installed build expires.

Load Library and Clippings online before testing in airplane mode. The app and
Shortcuts can then read saved data without the Mac or server being reachable.
