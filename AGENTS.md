# Codex / agent guide

## Start here

- This is a Windows x64 Stream Deck plugin: TypeScript runtime, two Rust helpers, and an optional Chrome MV3 extension.
- Read `git status --short` before editing and preserve unrelated work.
- Run `node scripts/doctor.mjs` for prerequisites. Install locked JS dependencies with `npm ci` when needed.
- Use `node scripts/check-fast.mjs` (or `npm run check:fast`) for the default edit/verify loop. It needs Node 24+ and installed dependencies, but no Rust build, installed Stream Deck, or browser download. It stops on the first failure.
- Read [development workflow](docs/development.md) for targeted tests and additional checks. Do not equate a fast-check pass with release readiness.

## Where to edit

| Task | Source / starting point |
|---|---|
| Action registration and lifecycle | `src/plugin.ts`, `src/configured-action.ts` |
| Buttons, dials, now-playing | `src/control-actions.ts`, `src/now-playing-actions.ts` |
| Session selection, state, commands | `src/media-model.ts`, `src/media-state.ts`, `src/media-commands.ts` |
| Rendering | `src/control-image.ts`, `src/now-playing-image.ts`, `src/scrolling-text.ts` |
| Settings UI | `dev.n7s.media-controls.sdPlugin/ui/settings.{html,css,js}`, `src/property-inspector.ts` |
| Windows transport / wire | `src/native-client.ts`, `src/native-wire.ts`, `native/media-info/src/` |
| Windows media keys | `native/media-keys/src/main.rs` |
| Chrome transport / identity | `src/chrome-*.ts`, `scripts/chrome-native-host.mjs` |
| Chrome page / worker | `chrome-extension/page-main.js`, `bridge-isolated.js`, `background.js` |
| Translation | `locales/en.json`, `locales/ja.json`; see [translation guide](locales/README.md) |

The `.sdPlugin` directory contains both hand-written source and generated output; do not treat the entire directory as disposable. More runtime boundaries are in [source structure](docs/source-structure.md).

## Generated files and invariants

- Do not hand-edit `src/locale-data.generated.ts`, either `localization.js`, or Chrome `_locales/*/messages.json`. Run `npm run locales:build` and include generated changes.
- `.sdPlugin/bin`, `.sdPlugin/native`, `.sdPlugin/node_modules`, Rust `target`, and `tests/.generated` are ignored build/test output.
- Generate store descriptions and images using the commands in [documentation index](docs/README.md). Rendering changes require `npm run marketplace:build` and `npm run marketplace:check`.
- Keep package/lockfile/manifest versions consistent; change versions only for an intended release. Preserve lockfiles.
- Missing metadata stays unknown; do not invent titles, positions, or command capabilities. Commands must target the last displayed session; ambiguous targets must not receive fallback global commands.
- Preserve authenticated local transport, origin checks, bounded payloads, and stale-session rejection. See [communication design](COMMUNICATION.md) when changing protocols.
- Historical audit results are historical. Never fabricate hardware acceptance or update `docs/release-review.json` evidence merely to make a check pass.

## Completion

Run focused tests while editing, then the fast check for code/tooling changes. Add the applicable native, browser, packaging, or rendering checks from the development guide. Report what changed, commands that passed, and checks that could not run. Documentation-only changes normally need `npm run consistency:check`.
