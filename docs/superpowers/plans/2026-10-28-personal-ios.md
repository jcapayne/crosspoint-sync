# Personal Team iOS Implementation Plan

> Execute inline using superpowers:executing-plans.

**Goal:** Build and run on a free Personal Team with offline App Intents.
**Architecture:** Generate an isolated ignored copy with personal signing settings and no widget/Universal Links. App Intents read a main-app cache shared with Rust through Application Support.
**Tech Stack:** Python stdlib, Tauri, Rust, Swift.
**Spec:** docs/superpowers/specs/2026-10-28-personal-ios-design.md

## Global Constraints
- Keep official release settings intact.
- Preserve iOS 16 and offline cache behavior.
- No automatic device installation during implementation.

## Review Focus
- App and widget dependencies must be removed in the generated build.
- Config and entitlements must not request official team capabilities.
- Rust and Swift must resolve exactly the same private cache path.
- Fresh generation must include current source changes and avoid nested copy loops.
- Personal installs must use development running, not IPA export.

## Tasks
- [x] Test-first: generated project removes restricted signing, preserves original bytes, uses a unique bundle ID, and validates team IDs; implement personal prepare/run script and npm commands.
- [x] Test-first: verify native private cache loading; move Rust publication and Swift reading to matching Application Support paths.
- [x] Run Python, Swift, Rust and app checks; compile personal iOS build without signing where available; document phone signing/run workflow and restrictions.

Execution authorized by user's choice of free Personal Team. Work stays on codex/ios-shortcuts.

## Verification

- Python: 2 generator tests passed, including untouched official project bytes, removed widget/dependencies/entitlements, preserved selected team and unique bundle ID.
- Swift: 12 native store checks passed, including private cache path and load without an App Group.
- Rust: 2 standalone persistence/path tests passed.
- App: 239 tests passed (21 files). Excluded the ignored generated copy from Vitest to avoid duplicate discovery.
- Full isolated Tauri iOS Simulator build completed successfully with --debug --target aarch64-sim --no-sign. Verified its unique CFBundleIdentifier, absence of embedded PlugIns/widget, and all three extracted App Intents.
- iOS 16 device-target Swift typecheck passed.
- Independent review found no confirmed correctness issue. Final workflow uses build --debug --open and Xcode Run so frontend assets are bundled and Personal Team provisioning avoids IPA export.
- Phone signing/install requires the human to select their Personal Team and press Run in Xcode; no credentials or team ID were guessed.

Follow-up: Xcode GUI build failed because its shell could not find cargo. Added rustup/Cargo and Homebrew directories to the Build Rust Code PATH in project.yml, the official generated project and the existing personal copy, preserving the selected Personal Team. Three generator/build-phase tests pass, including execution with an Xcode-like minimal PATH. Verified cargo tauri resolves under that PATH.
