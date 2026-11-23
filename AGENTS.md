# Codex / agent guide

## Start here

- This is a Windows x64 / macOS Stream Deck plugin: TypeScript runtime, two Rust helpers, and an optional Chrome MV3 extension.
- Read `git status --short` before editing and preserve unrelated work.
- Run `node scripts/doctor.mjs` for prerequisites. Install locked JS dependencies with `npm ci` when needed.
- Use `node scripts/check-fast.mjs` (or `npm run check:fast`) for the default edit/verify loop. It needs Node 24+ and installed dependencies, but no Rust build, installed Stream Deck, or browser download. It stops on the first failure.
- Read [development workflow](docs/development.md) for targeted tests and additional checks. Do not equate a fast-check pass with release readiness.

## Where to edit

| Task | Source / starting point |
|---|---|
| Action registration and lifecycle | `src/plugin.ts`, `src/streamdeck/configured-action.ts` |
| Buttons, dials, now-playing | `src/streamdeck/control-actions.ts`, `src/streamdeck/now-playing-actions.ts` |
| Session selection, state, commands | `src/media/media-model.ts`, `src/media/media-state.ts`, `src/streamdeck/media-commands.ts` |
| Rendering | `src/rendering/control-image.ts`, `src/rendering/now-playing-image.ts`, `src/rendering/scrolling-text.ts` |
| Settings UI | `dev.n7s.media-controls.sdPlugin/ui/settings.{html,css,js}`, `src/streamdeck/property-inspector.ts` |
| Windows transport / wire | `src/native/native-client.ts`, `src/native/native-wire.ts`, `native/media-info/src/` |
| Windows media keys | `native/media-keys/src/main.rs` |
| Chrome transport / identity | `src/chrome/`, `scripts/chrome-native-host.mjs` |
| Chrome page / worker | `chrome-extension/page-main.js`, `bridge-isolated.js`, `background.js` |
| iCUE bridge | `src/icue-bridge.ts`, `src/icue/`, `src/streamdeck/icue-integration.ts` |
| Translation | `locales/en.json`, `locales/ja.json`; see [translation guide](locales/README.md) |

The `.sdPlugin` directory contains both hand-written source and generated output; do not treat the entire directory as disposable. More runtime boundaries are in [source structure](docs/source-structure.md).

## Source boundaries

- Keep startup in `src/plugin.ts` and `src/icue-bridge.ts`; importing a feature module must not register actions or start a server.
- Put SDK-facing lifecycle/settings in `src/streamdeck/`, media selection/validation in `src/media/`, image generation in `src/rendering/`, and transport code in `src/chrome/`, `src/native/`, or `src/icue/`.
- Import the owning module directly; avoid compatibility re-exports at the old flat paths. Tests use explicit paths such as `load("media/media-model")`.
- Runtime `import.meta.url` asset paths are relative to the bundled `bin/` entry point, not the source directory. Do not add `../` when moving source files.

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
