# Development — vscode-tm1-ti

Build, test, and workflow reference for the TM1 IDE extension. The project is
MIT-licensed (see `LICENSE`). Issues and pull requests are welcome; for a larger
change, open an issue first so we can agree on the approach. Security problems
go through private reporting, see `SECURITY.md`.

## How this code is written

Most of the code is written with Claude Code (an AI coding agent) under the
maintainer's direction. Every change passes the quality gates below in CI.
Behavior against live TM1, PAW and PA as a Service servers is verified by the
maintainer by hand, not by CI.

## Prerequisites

- Node.js 20.x (CI runs on 20)
- VS Code ≥ 1.85

## Setup

```bash
npm ci
npm run compile          # build:signatures + esbuild → out/
```

## Develop

- Launch the Extension Development Host with **F5** (`.vscode/launch.json`).
- A simple window reload is **not** enough after a rebuild — restart the EDH (F5).

## Quality gates (run before every PR)

```bash
npm run check            # typecheck, lint, lint:dead, lint:promises, compile, test, lint:deps
```

`compile` runs before `test` on purpose: some tests execute the built webview
bundles in `out/`. CI additionally runs coverage, `npm run audit` and the
integration tests (`.github/workflows/ci.yml`).

Unit tests use a mock VS Code API (`src/test/__mocks__/vscode.ts`) — no real VS Code needed.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `test:`, `perf:`, `refactor:`).
- **No version bump per fix** — `package.json#version` is bumped only at releases.
- New webview shells go through `renderWebviewShell()` / `WebviewPanelHost` — never hand-copy CSP templates.

## Dependencies that stay where they are

Dependabot ignores these (`.github/dependabot.yml`); they were checked and rejected:

- **`dependency-cruiser` 18** needs Node `^22||^24||>=26`. CI and VS Code run the
  extension on Node 20, so `npm run lint:deps` would abort at start.
- **`@types/node`** is coupled to the runtime (Node 20), **`@types/vscode`** to
  `engines.vscode`. Higher types let the checker accept APIs that do not exist there.
- **`eslint` / `@eslint/js` 10** only together with `typescript-eslint`, as one jump.
- **`monaco-editor` 0.56** moved its types under `esm/vs/index.d.ts`, resolvable only
  with `moduleResolution` `node16`/`nodenext`/`bundler`. Switching the test project
  breaks the `import x = require(...)` lines in production files.
- **`@vscode/vsce` 4** and **`ovsx` 1.2+** need Node `>=22`. `release.yml` packages
  and publishes on Node 20; CI never calls either, so it stays green while a release
  would fail.
- **`vitest` 5** and **`@vscode/test-electron` 3** need Node `>=22` (`^22.12` for
  vitest). vitest 5 fails `npm ci` in CI; test-electron 3 passes only because npm
  does not enforce `engines`. Both wait for the Node jump.
- **`typescript` 7** conflicts with `typescript-eslint` 8 (`ERESOLVE`); it moves only
  together with the eslint toolchain.

## Packaging

```bash
npx vsce package --no-dependencies   # → vscode-tm1-ti-<version>.vsix
```

## Change workflow

1. Branch off `main`.
2. Keep changes focused; one concern per branch.
3. Ensure `npm run check` is green before merging.
4. Describe **what** and **why** in the commit/PR body.
