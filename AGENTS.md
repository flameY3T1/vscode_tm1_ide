# AGENTS.md

Guidance for AI coding agents (and humans) working on this VS Code extension.

This project is developed largely with AI assistance. Every change must pass the
gates below; behavior against a live TM1 server is verified by the maintainer, not by CI.

## Before you finish

Run `npm run check`. It runs, in this order:

1. `typecheck` — all four TypeScript projects (root, `webviewClient`, `test`, `test-integration`). `npm test` does **not** typecheck.
2. `lint` — `eslint src --max-warnings 0`
3. `lint:promises` — type-checked: floating promises, exhaustive `switch`
4. `compile` — signatures + esbuild into `out/`
5. `test` — vitest. Run it **after** `compile`: several guards execute the built bundle and fail on a missing or stale one.
6. `lint:deps` — dependency-cruiser layer rules and cycles

Green gates are not proof the feature works. `tsc -p ./` skips `src/webviewClient/` and `src/test`, and nothing covers UI or user-facing text. Build the VSIX (`npx vsce package --no-dependencies`) and use the feature.

## Rules that catch people

- **`*Pure.ts` never imports `vscode`** (also `webviewClient/` and `tm1Rest/`). CI enforces it. Put vscode-dependent logic in the calling `commands/` or `providers/` module.
- **Mocks:** `vi.mock('../tm1Client')` does not cover `tm1Rest/*`. Also mock the deep path: `vi.mock('../tm1Rest/client', async () => await import('../tm1Client'))`.
- **Response bodies:** use `parseBody<T>(res)` / `parseBodySafe<T>(res, fallback)` from `src/tm1Rest/parseRest.ts`, never `JSON.parse(res.body)` with a manual release.
- **Webviews:** build shells with `renderWebviewShell()` and panel managers with `WebviewPanelHost`. Omit `viewColumn`. Inside template literals use `\\n`, never a backtick in a comment.
- **Panel close:** `onDidDispose` must remove the registry entry synchronously.
- **Tree nodes** need stable ids (`_buildId()`), or the tree collapses on refresh.
- **Sessions:** one session per `Tm1Config`; never send cookie and Basic auth together; build configs with `buildTm1Config()`.
- **Comments in code are English.** User-facing strings are English with German in `l10n/` and `package.nls.*`. After writing new strings, compare length and sha256 against the source; a shortened string passes every gate.
- **No production object names** in source; describe the situation instead.

## TM1 REST facts worth knowing

Measured against live servers.

- `PATCH` needs `If-Match` (the transport sets `*`). Collection semantics differ: `Subsets/Elements` append, `Users/Groups` replace, `DataSource` merges.
- Never use `$select=*` (it returns less than the default projection). `/$count` needs `?$format=text/plain`.
- Send cell values as JSON numbers. `Cells.Updateable` is a bitmask.
- A `DataSource` unknown key fails the whole PATCH; build payloads via `utils/dataSourceWire.ts#cleanDataSource`.

## Don'ts

- Don't bump the version, publish, or push without the maintainer's say-so.
- Don't change working code next to your task; every changed line should trace to the request.
- Don't run TI capture or anything that executes processes against a production server.

More: `CONTRIBUTING.md`.
