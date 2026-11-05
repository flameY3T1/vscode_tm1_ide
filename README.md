# TM1 IDE for IBM Planning Analytics / TM1

Write TurboIntegrator processes and rules with autocomplete, a configurable linter and a server-backed compile check. Debug TI with breakpoints. Browse and edit cubes and dimensions, in native views and MDX.

*Independent project, not affiliated with or endorsed by IBM. IBM, Planning Analytics and TM1 are trademarks of IBM Corporation.*

---

## Why TM1 IDE

- **TI debugger:** breakpoints, a variables panel and Run with Coverage in VS Code, against your real server.
- **Several servers in one window:** Dev, test and production side by side, with bulk deploy between them.
- **Linter and compile check:** quick fixes, server compile check on save, `CheckRules` for rules.
- **Git mirror:** processes and rules as files, drift detection, Pull / Push / Diff.
- **Privacy:** no telemetry, see [Security & privacy](#security--privacy).

---

## Requirements

- VS Code 1.85 or later.
- TM1 11 or TM1 12 with the REST API enabled.
- Debugging a process needs `EnableTIDebugging=T` on the server.
- TM1 Top needs TM1 11 and a local TM1 client on Windows.

**Not supported:** TM1 servers without the REST API; Windows integrated login (SSO) on TM1 12; TM1 Top on TM1 12 or outside Windows.

---

## Getting started

1. **Install:** Extensions (`Ctrl+Shift+X`), search "TM1 IDE", Install, then fully restart the IDE.
2. **Add a server:** TM1 Explorer icon, then Add Server. A form walks every field; passwords go to the OS keychain.
3. **Open something:** cubes, dimensions, processes, chores, views, files, threads, message log and the MDX Runner hang under each connected server. Several connections stay open at once.
4. **Debug a process:** open it, click left of a line number to set a breakpoint, press `F5`. The variables panel shows the values at each stop.

---

## The tools in detail

### Process editor

- Autocomplete for TI functions, variables, cubes, dimensions and hierarchies, also inside string arguments.
- Linter with per-server rule sets and quick fixes; formatter, snippets, templates and a server compile check on every save.
- Debugger with breakpoints, conditions, stepping and a variables panel. Run with Coverage marks the lines one run reached.
- Data source editor for files and ODBC, with a preview read by the server. TI console for statements without a process.

### Rule editor

- Context-aware autocomplete, `DB()` and `[]` builders, `CheckRules` on save, static and server-backed linter.
- Cell trace from the cube viewer: the rule behind a value, the cells a feeder feeds, and whether a cell is fed at all.

### Cube viewer

- Native views and MDX in one grid: drag-and-drop pivot, alternate hierarchies, aliases, paging for large views.
- Copy to Excel and paste blocks back; write-back with spreading on consolidated cells (`~N` proportional, `%N` adjust by N %, `!N` value into every leaf, `~~` clear; TM1's own codes such as `P100` pass through to the server) and sandboxes.
- Save as native or MDX view; display formats per element with live preview.

### Dimension browser and editor

- Browser: tree or set, filter, drill to a level, save as subset. Also the element picker in the cube viewer and the process editor.
- Editor: drag-and-drop hierarchies, multi-edit attributes, usage check before delete.
- Compare Consolidations: finds missing, double or wrongly weighted elements against a reference and fixes them.

### MDX runner

- `F5` runs the query, with autocomplete, live element checks, history and TSV export.

### TM1 Notebook

- Month-end checklists, loads and reconciliations as MDX, TI and Markdown cells, run with one click.
- `// check: empty` or `// check: = 1234567 ± 5` turns a query into pass or fail; the summary exports as a Markdown report.

### Operations

- Threads with lock-wait chains and cancel, TM1 Top.
- Message log with run analysis; transaction log with search and undo of selected changes.
- Chores with calendar and last run, files, RAM dashboard, server configuration.

### Analysis

- Object overviews for processes, dimensions and cubes: lint counts, unused dimensions, feeder ratio.
- Find references, call graphs, lineage, search and replace across objects, find overfed cells.

### Security

- Matrices for cubes, dimensions, hierarchies and processes; element and cell security builders.
- User and group manager; impersonation shows the model through another account's rights (TM1 11.1 or later).

### Across servers

- One tree for every connection, admin-server discovery, PAW gateway, Go to Object, Recent & Favorites.
- Bulk deploy and bulk delete: each row says what exists on the target, what it still lacks, and what still refers to an object before it is deleted.

### Beyond the server

- Git mirror, Bedrock install and update, UI in 7 languages.
- TI test framework *(beta)*: record a process run, replay it offline. Recording changes server state: Dev/Sandbox only, at your own risk.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Extension does nothing, tree stays empty | Restart the IDE fully after install. |
| Cannot connect | Check that the REST port (`HTTPPortNumber` in `tm1s.cfg`) is reachable and that the profile's SSL setting matches the server. |
| SSL certificate error | The server uses a self-signed certificate. Turn off verification in the server profile, on trusted networks only. |
| Debugger does not start | Set `EnableTIDebugging=T` in `tm1s.cfg`. |
| No cubes or elements in autocomplete | Autocomplete needs a connected server. Connect it in the TM1 Explorer. |

---

## Shortcuts

| Action | Key |
|---|---|
| Debug or continue (process) · Run query (MDX, TI console) | `F5` |
| Run without debugging (process) | `Ctrl+F5` |
| Step over · Step into · Step out · Stop | `F10` · `F11` · `Shift+F11` · `Shift+F5` |
| Save / Save As (process) | `Ctrl+S` / `Ctrl+Shift+S` |
| Format code | `Ctrl+Shift+I` |
| Rename symbol | `F2` |
| Find references | `Shift+F12` |
| Toggle comment | `Ctrl+/` (`Ctrl+#` on a German keyboard) |
| TI console · Message log · Threads | `Ctrl+Alt+J` then `C` · `L` · `T` |
| MDX runner · Find & replace · Go to object | `Ctrl+Alt+J` then `M` · `F` · `O` |

On macOS use `Cmd` in place of `Ctrl` inside the editors.

---

## Settings

All settings start with `tm1.` and are described in the Settings UI. The ones you are most likely to touch:

- `tm1.maxSockets` (default 4): requests running at the same time per server. TM1 binds one worker thread to each connection; lower it to 1–2 if a CAM environment is sensitive to thread count.
- `tm1.timeoutMs` (default 0 = none): HTTP inactivity timeout. A busy server may compute for a long time without sending data, so only set it if you need a cap.
- `tm1.v12Mode`: flags TI functions that no longer exist in TM1 12.
- `tm1.cubeViewer.copyDecimalSeparator`: decimal separator for copied cells, so Excel reads them as numbers. `auto` follows the OS locale.
- `tm1.nativeApiPath`: TM1 `bin64` directory for TM1 Top, if it is not in a standard IBM installation directory.

---

## Security & privacy

- **No telemetry:** nothing leaves your machine.
- **Credentials in the OS keychain:** never in plain text or config files.
- **Direct connection only:** your machine straight to your TM1 servers. No third-party endpoints, except that installing Bedrock fetches the release from GitHub, and only when you ask for it.
- **Per-profile SSL:** disable self-signed verification only on trusted networks.
- **Limited in Restricted Mode:** the extension runs, but the workspace cannot set `tm1.tests.rootFolder` or `tm1.nativeApiPath`. Server profiles and credentials live outside the workspace, so a folder cannot redirect them.
- **Remote-SSH / WSL:** runs as a `workspace` extension.

---

## Pair it with the TM1 MCP Server

From the same author: the [TM1 MCP Server](https://github.com/flameY3T1/tm1-mcp-server) lets Claude, Cursor or Copilot talk to TM1 directly: process logic, rule debugging, MDX, model analysis.

```bash
npm install -g tm1-mcp-server
```

---

## Acknowledgments

Thanks to **the best TM1 community in the world — at Deutsche Bahn** — for the inspiration, and for finding the bugs. This exists because of you.

And a tip of the hat to [**linti**](https://github.com/deutschebahn/linti), the inspiration behind this extension's linter. 😉

---

## License

MIT License, copyright (c) 2026 flameY3T1. See the LICENSE file.
