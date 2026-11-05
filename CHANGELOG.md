# Changelog

## [1.0.54] — 2026-11-05

### New

- **Startup Analysis**: startup history with the previous end and the downtime.

### Fixed

- **Debugger**: stopping a session no longer ends other runs of the same process.
- **Cube Viewer**: a late answer no longer overwrites a newer view.
- **Subset**: a failed overwrite restores the old content.
- Two profiles on one server each work as their own user.

## [1.0.53] — 2026-11-02

### New

- **Add Server**: from the URL alone, the form picks the matching variant (v11, v12, PAW, PA as a Service) and offers its databases.
- **Process Run Analysis**: failed runs link to their error log; **Analyze Runs** on a chore.
- **Linter**: warns when an `ExecuteProcess` result is compared against a code that differs on TM1 12.
- Cancel button for long runs; delete several servers at once.

### Changed

- **TI Test**: capture is a full live run.
- Run/Debug remembers parameter values per server.
- Faster tree, overviews and security matrix.
- Licensed under MIT.

### Fixed

- **Connection test**: an unreachable server fails after 20 s (`tm1.connectTimeoutMs`) and names the actual cause instead of "wrong password".
- **Process**: Save in file mode no longer overwrites a newer server version.
- **Dimension editor**: all changes reach the server after a partial commit.
- Security: dompurify 3.4.17.

## [1.0.52] — 2026-10-22

### New

- **Security Manager**: filter box for users and groups; matches name and alias.
- **Impersonate** shows the CAM alias instead of the user id (picker, status bar, messages).
- **Copy element as MDX member reference** in the context menu.
- **TI Test**: capture works on v12; the simulator covers the JSON functions.
- **Browser login** for PA as a Service and Planning Analytics Workspace: log in in Edge or Chrome (IBMid, MFA, SAML) instead of an API key or password.

### Changed

- **TI Test**: capture asks before every run and logs the writes it runs live; the hidden server-side replay is gone.
- **Process editor**: *Insert ExecuteProcess* puts one parameter per line.

### Fixed

- **TI Test**: capture values with line breaks stay one record; the simulator reads umlauts in identifiers and source files in the server codepage.
- **Process Run Analysis**: with *Hide } processes*, the run count above the list matches the list.

## [1.0.51] — 2026-10-15

### New

- **PA as a Service (v12 SaaS)**: connect with an API key; run logs and their analysis work there too.
- **Process Run Analysis**: *Hide } processes*; on v12, `RunProcess` runs appear under their caller.

### Changed

- **Add/Edit Server**: each v12 login mode explains its fields.
- **Dimension Browser**: the attribute column picker marks aliases.

### Fixed

- **`.pro` deploy and export** keep what TM1 wrote: numeric parameters, *Security Access*, subset, source names, empty quote characters, trailing blank lines.
- **Process editor**: saving keeps an empty client file name and quote character.
- **Cube Viewer**: a long hierarchy name in an axis chip no longer overlaps the columns zone.

## [1.0.50] — 2026-10-13

### New

- **Open Process as File**: edit a process's Git files (`.ti` + `.json`) in the process editor. The file is the source; changes from other tools, AI edits and `git` show up live, undo still works.

### Changed

- **Git export** writes processes in the server's native format (TM1 11.x and 12 differ): the `.ti` is TM1's code blob, the `.json` header follows the REST key order. The first pull after updating rewrites existing process files once.

### Fixed

- **Drill** (Cube Viewer, Dimension Browser): expand/collapse hits every occurrence of an element with several parents.
- **Cube Viewer**: expanding or collapsing keeps the scroll position.
- **Problems panel** for `.ti` files knows the parameters and variables from the `.json`; in a Git compare, the server side is checked against its own server.
- **Git mirror**: two connections to the same server keep their own Git setting and folder.

## [1.0.49] — 2026-10-09

### New

- **Sort order** of a hierarchy (Dimension Editor toolbar and tree context menu): element and child order as dropdowns instead of `}DimensionProperties` cells.
- **Hierarchies under cube dimensions** in the tree; **Compare Consolidations** also from a cube's dimension.

### Changed

- **Linter**: "potential endless loop" is a warning and no longer blocks saving.
- **Dimension Browser**: attribute search on "none" checks the name and aliases only — much faster on large dimensions.

### Fixed

- **Cube Viewer**: title dimensions show the active alias; the view name stays prefilled when saving after a pivot.
- **Dimension Browser**: the context menu closes on a click elsewhere.

## [1.0.48] — 2026-10-08

### New

- **v12 Readiness Check** (Tools node of a v11 server): read-only scan of what would break on TM1 12.

### Changed

- **Opening a `.pro` or `.rux` offline** no longer reconnects the last servers. They reconnect when the TM1 view opens or a command needs a server.
- **Restricted Mode**: linter and completion work; the workspace cannot set the TI test folder or the native API path.

### Fixed

- **Cube Viewer** keeps a pivoted layout after writing a value; empty picklist cells are left-aligned.
- **IBM documentation links** point to 2.1.0 on v11 and 3.1.0 on v12.

## [1.0.47] — 2026-10-06

### New

- **Compare across servers**: Bulk Deploy compares processes, chores, views and subsets with the target and opens a diff. Compare Consolidations takes another server as reference.
- **Copy groups** from one user to another in the Security Manager.

### Fixed

- **Impersonation** of an ADMIN member is refused up front instead of failing on every request.
- **Closing a window** cancels its pending reads.
- Object overview column headers and TI test messages are translated.

## [1.0.46] — 2026-10-02

### New

- **Compare Consolidations…** on a dimension: checks consolidations against a reference and fixes missing, double or wrongly weighted elements.
- **Command `tm1.editor.insertText` for other extensions**: inserts text (or a snippet with `snippet: true`) at the cursor of the active process or rule editor; returns `false` when none is open.

### Fixed

- **Unload**: a cube unloaded from the explorer stays marked as unloaded; SaveData is no longer offered on it.
- **Cube viewer**: no trailing colon after title dimension names.
- **Dimension editor**: top-level elements show in index order and can be reordered by drag and drop.

## [1.0.45] — 2026-09-30

### New

- **Filter in the view and subset pickers**: the cube viewer's view list and the dimension browser's subset list open with a filter box at the top, like the title elements.

### Fixed

- **Move into New Window**: the dimension browser loads again, and the cube viewer keeps its layout.
- **Overviews**: compact tiles leave more room for the table.

## [1.0.44] — 2026-09-29

### New

- **Cube viewer: alternate hierarchies** on rows, columns and titles; pick one per chip or add a second one of the same dimension.

### Fixed

- **Notebook**: Stop on a running TI cell cancels the thread on the server, not only the wait.
- **Dimension editor**: attributes are read and written through the edited hierarchy.
- **Cell trace, picklists and "Format Elements…"** work on dimensions whose default hierarchy is not named like the dimension.

## [1.0.43] — 2026-09-28

### New

- **TM1 Notebook** (`*.tm1nb`): MDX, TI, parameter and status cells with checks and reconciliation, templates and a Markdown report.
- **Format helper** in the cube viewer: display formats per element with live preview, saved into MDX views or as the element's `Format` attribute; "Format Elements…" on a dimension.
- **Applications overview**: tree plus a scan of workbook formulas that names missing cubes and dimensions.
- **Quick fixes** in the process editor: semicolon, `=`/`@=`, casing, unused assignment, and disabling a rule for one line.
- **Overviews**: clickable tiles as filters, lint counts for processes, unused dimensions, feeder ratio for cubes.
- **Lineage** tab and a server data-flow map of chores, processes and cubes.
- **Load or Unload** a cube from the tree, depending on its state.
- **Chore calendar**, **Go to Object** across connected servers, **export and import of the server list**.
- **Favorites** in "Recent & Favorites"; editor tab icons for the TM1 windows; "Tools" folder in the tree.
- **Cell trace** shows the formula with operand values and loads one level per expand.

### Changed

- TM1 shortcuts moved to the `Ctrl+Alt+J` chord.

### Fixed

- Locked cells are detected correctly in the cube viewer.
- Closing the cube viewer or the MDX runner while a call was still running no longer throws "Webview is disposed".

## [1.0.42] — 2026-09-24

### New

- **Run with Coverage**: runs a process in the debugger and shows which lines and branches it reached.
- **Transaction log**: search who changed which cell, and undo selected changes.
- **Column widths** in log, thread and overview windows can be dragged and are remembered.
- **The session dot** behind a server shows whether its session is still alive.

### Removed

- **Server Health** — threads and TM1 Top cover it.

### Fixed

- String cells in the cube viewer stay text, even when they look like numbers.
- Data Files lists only real files.

## [1.0.41] — 2026-09-20

### New

- **TI console**: run TI statements against a server without creating a process.
- **Impersonation**: take an account's view of the data and the object tree for the session, from the server's menu or from the user list of the security manager. Needs TM1 11.1.0 or later and an administrator account; TM1 Database 12 has no impersonation.
- **Bulk delete**: a page that collects cubes, dimensions, processes, chores, views and subsets and names, per entry, what still refers to it — rules, processes, chores, views and subsets — before anything is deleted.
- **Bulk deploy**: copy processes, rules, chores, views and subsets to a second server in one run. Each entry shows whether it already exists there and what it needs that the target does not have yet.
- **Deploy a single rule or chore to another server** from its tree entry, like a process.
- **MDX formatter** in the MDX runner and in both MDX popups, with a drag handle instead of a fixed editor height.
- **Message log**: filter by source, source and thread as columns, and a window of up to 10000 lines.
- **Chore and process overview** show the last run, its duration and the current run state.
- **Hierarchy suggestions inside TI string arguments**, where only dimensions were offered before.
- **Escape closes every dialog that Enter confirms.**

### Changed

- **The tree context menus are shorter.** Actions that sit as an icon in the row — refresh, edit, connect, disconnect, delete — are no longer repeated in the menu. *Find and Replace* on a server now opens the same submenu as on the Processes node.
- Listing cubes with rules asks the server for the rule-carrying cubes instead of reading every rule text.

### Fixed

- **A failed credential migration no longer keeps the extension from starting** — it reports the step and carries on.
- **A debug type another extension already claims costs only the debugger**, not the whole extension. A hand-written `launch.json` entry with `"type": "tm1"` needs `tm1-ide`.
- **A dropped connection no longer surfaces as an unhandled error**; it is reported as the failed request it is.
- **Three false alarms of the MDX name check** are gone, and an unclosed bracket is no longer invented.
- **Server configuration accepts nested parameter names and numeric choices.**
- **Where the run statistics show "—", the tooltip says why.**

## [1.0.40] — 2026-09-17

### New

- **A Planning Analytics Workspace gateway can be added as a server entry.** It discovers the TM1 databases behind the gateway the way an admin server discovers instances, and they connect through the gateway. Needs a Basic credential.
- **Hide instances…** on an admin server or gateway removes discovered instances for good — discovery no longer adds them back. *Take instances back into the group…* undoes it.

### Fixed

- **TM1 Top needs no IBM TM1 installation** — just point it at the folder that holds the TM1 Top files.
- **The cube viewer tab keeps the name of the view it shows**, and a saved workbench reopens that view instead of the one it started from.
- **Enter finishes a name dialog** instead of leaving the keyboard at the buttons.

## [1.0.39] — 2026-09-15

### New

- **TM1 Top**: a live thread monitor for TM1 11 servers, on a server node and on an admin server. It needs no REST login, so a server that nobody can log into any more still shows what its threads are doing. Cancelling a thread asks for an administrator account first. Windows x64 with an installed IBM TM1 client.

## [1.0.38] — 2026-09-03

### New

- **Find overfed cells**: a cube's context menu now offers a scan for cells that a feeder reaches but that hold no value. Unfold a row to see the feeder statements that can produce it; a click on one opens the rule editor there. Needs an administrator account on the TM1 server.
- **The interface speaks five more languages**: Spanish, French, Italian, Brazilian Portuguese and Polish, including the TI function help.

### Fixed

- **A syntax error no longer swallows the rest of its block.** One bad line inside an `IF` used to discard every finding before it and invent a second error at the `ENDIF`.
- **A native view and an MDX view of the same name no longer break the Views branch** — it stayed empty for the whole cube.

## [1.0.37] — 2026-08-31

### New

- **Named credentials**: store a user and password once, pick it in any server profile or admin server. An admin server can hand a default one to the instances it discovers.
- **Bedrock picks the edition that fits**: Bedrock 5 on TM1 Database 12, Bedrock 4 on TM1 11.x.
- **Control objects come along into the Git mirror**: `}`-processes and the rules of the attribute and system cubes.
- **Linter rules are configurable in the rule editor**, on a tab next to the findings.
- **Ignored source columns** are shown and settable in the *Variables* tab of the process editor.

### Changed

- Pulling from Git reads the rule text with the cube list — one request less per cube.
- **Pull All no longer refuses a mirror outside a git repository.** The missing safety net is now stated in the confirmation dialog, which names the directory and offers *Pull anyway*.
- **Server configuration: values that were hiding under a different name are shown, and can be edited.** `HTTPSessionTimeoutMinutes`, `IdleConnectionTimeOutSeconds`, `ServerCAMURI` and `MTQ` carry their value again, converted from the REST leaf it actually lives in, and a change is converted back on save. `MTQ` takes `ALL`, a thread count, or a negative count. The leaf they cover no longer appears twice.
- **Server configuration: every duration is shown and entered in seconds.** The server reports them as `P0DT01H00M00S`; the row says which unit it takes.
- **Server configuration: the tabs carry the parameters again.** Rows used to be filed by the first segment of their REST path, so four unnamed tabs held everything and the ten named ones stood nearly empty.
- **Server configuration: 121 descriptions for the nested parameters**, so a row no longer reads *Nested config-leaf: …*. Measured against both a TM1 11.8 and a TM1 Database 12 instance — every leaf either server exposes now carries a description and a type.

### Fixed

- **Server health no longer draws an outage as a load drop.** A failed thread query used to be stored as `0` threads, so an unreachable server looked like an idle one and stayed that way for 24 hours. Unmeasured values are now gaps in the chart, an outage is shaded, and the peak is taken over what was actually measured.
- **Deleting a TI test now refuses anything outside the test folder.** The path is resolved through `realpath` first, so a symlink cannot lead out of the tree either, and the test folder itself can no longer be deleted along with its contents.
- **Pushing to Git carries an empty parameter list through to TM1.** Emptying the parameters of a process in the repository used to report success while the server kept its old ones. A header file that says nothing about parameters still leaves the server list alone.
- Server configuration no longer offers eight parameters that do not exist (`EnableTM1WebMTQ` among them) — measured against both a TM1 11.8 and a TM1 Database 12 instance, neither server knows any of them.
- Server configuration: the twenty parameters TM1 renamed in REST (`PortNumber` → `Access.CAPI.Port` and friends) show their description again instead of the bare leaf path.
- Server configuration: a parameter that carries a value but takes no write is now marked read-only instead of *N/A*, which reads as "not on this server". Affects the keys of the legacy configuration view (`ProductVersion`, `WebCAMURI`, `DistributedOutputDir`), which now carry a description as well. Three others (`SecurityMode`, `PrincipalName`, `ClientCAMURIs`) only echoed a row that can be edited, and are gone.
- Usage of dimensions and subsets.
- Wizard state and ignored source columns survive export, copying and Git.
- Webviews follow the language of the interface.
- A connection to a port that speaks no TLS is named as such and retried with the other scheme.

## [1.0.36] — 2026-08-28

### New

- **TM1 Admin Server**: add one and the instances it reports appear beneath it, ready to connect. Single instances can be taken out into a folder and brought back later.
- **Swap axes** in the cube viewer exchanges rows and columns; the loaded values are re-arranged, not read again.
- **Delete server** is available from the context menu of every server node.

### Fixed

- Reloading a view works again after rows and columns were rearranged.
- A certificate error now names the setting that actually helps and offers to accept the certificate and connect in one step.

## [1.0.35] — 2026-08-26

### New

- **Run times in the call graph**: pick a run of the process and the tree shows how long each call took and where the time went.
- **Reload view** in the cube viewer reads the selected view from the server again — filters and context picks are dropped.

### Changed

- The message log analysis hangs asynchronously started runs under the process that started them and folds repeats into one line, so the tree stays readable.
- *Recent* keeps 15 entries instead of 5, and right-clicking a process offers run, open, delete and call graph.
- Attribute columns in the dimension browser are resized from their left edge.

### Fixed

- The server health history survives a second VS Code window.

## [1.0.34] — 2026-08-26

### New

- **Attribute columns in the dimension browser**: pick which attributes show as their own column — index and weight are in the same list — and drag the columns to the width you need. The choice is kept per server and dimension.
- **Startup analysis in the message log**: *Server start* breaks a restart into its phases and worker threads, so you can see where the time went.
- On v12 the message log shows the run logs instead of a notice. A server start cannot be analysed there — those lines only exist in the host's own file — and the button says so instead of returning nothing.

### Changed

- The message log filters by level **on the server**. Picking only *Error* now finds old errors instead of an empty list.
- The message log reads up to 2000 entries. A restart writes about 900 lines, so a 500-entry window could sit entirely inside one and look empty.

### Fixed

- **Expand fully** opens the whole subtree of the element you clicked, however deep, and leaves the rest of the view standing. Afterwards the triangle collapses it again — it did nothing before.
- The message log pairs a process run with its end by thread instead of by name and arithmetic, so the times are right when several runs overlap.
- Deleting a server profile no longer leaves its workbenches behind.
- Eleven texts were missing from the language bundles and stayed English in a German UI.

## [1.0.33] — 2026-08-25

### New

- **Workbenches**: save the windows you have open as a named set per server, and reopen them later. A picker decides what comes along; restoring opens them one after another and can be cancelled.
- The explorer deletes several views or subsets at once and copies them to another server.

### Changed

- Large dimensions scroll all the way through — there is no row limit any more, and the display stays fast because only the visible rows are drawn. Moving and inserting rows works up to 20,000 rows; above that, narrow the set with filters first.
- In the dimension browser, filters and selections are layers: each one shows a preview before it applies, and every layer can be taken back on its own.
- Control objects appear as collapsed clusters above the objects they belong to, instead of several hundred `}` names in one folder.

### Fixed

- The cube viewer carries the collapse state **and** narrowing done with *Keep only* into the saved MDX, the MDX window and the dimension browser, so all of them show what the grid shows.
- The context menu of a category is complete again while its control objects are shown — creating a cube, the overview, the security matrix, process grouping and Bedrock were all missing there.
- Autocomplete no longer offers v12-only functions on a 11.x server, where they cannot compile.

## [1.0.32] — 2026-08-19

### New

- Control objects can be shown or hidden per server **and** per object group, and the choice is remembered.

### Changed

- The dimension browser loads every dimension the same way, so large and small ones show the same thing.

### Fixed

- Expanding and collapsing works per row: an element listed under several parents opens and closes on its own.
- Ctrl+C copies the rows exactly as they are shown.
- The cube viewer keeps the element you pick for a context dimension when auto-refresh is off.

## [1.0.31] — 2026-08-18

### New

- **Preview an ODBC data source** in the process editor — the first 10 or 100 rows of the query, straight from the TM1 server, like the preview for delimited files.
- The new-process wizard handles ODBC sources properly: password, Unicode flag, and the DSNs the TM1 server knows.
- Pasting a single copied value into a multi-cell selection in the cube viewer fills every selected cell.
- The process editor and the rule editor highlight the current line in your VS Code theme's colour.
- The new `tm1.maxSockets` setting caps how many requests run at the same time per server (default 4).

### Fixed

- The extension reuses its connections to TM1 instead of opening a new one per request, so it no longer piles up worker threads on the server.
- ODBC and ASCII data sources save and load correctly again — query, user name and Unicode flag included — and saving one no longer takes the process code down with it.
- "Save as…" and deploying a .pro file carry an ODBC data source's password and Unicode setting over.
- An ODBC password is no longer kept anywhere outside TM1 — not in an exported .pro file, a Git repository, a process template, a recovered draft, or the deploy log; a restored draft or a process created from a template therefore comes without one.
- The new-process wizard keeps its entries when you switch to another window.

## [1.0.30] — 2026-08-14

### New

- **Picklists in the cube viewer** — marked cells, a dropdown of the allowed values, and a clear reason when TM1 refuses one.
- Pasted values are checked against the picklists before anything is written.
- **Create and delete a cube's picklist cube** from its context menu in the tree.
- **Set a hierarchy's default member** from the dimension editor's context menu, and reset it again.
- **Pick the element type when adding one** in the dimension editor — numeric, consolidated or string.
- **Copy elements with Ctrl+C and paste them into another hierarchy with Ctrl+V**, keeping the links between the selected ones.
- **Delete clears the selected cells** in the cube viewer — one cell or a whole selection.

### Fixed

- **Elements and links in an alternate hierarchy can be saved** — every change to one used to fail.

## [1.0.29] — 2026-08-13

### New

- **Paste values into the grid with Ctrl+V** — a cell, a column or a block, starting at the
  clicked cell.
- **The dimension editor opens from the dimension browser** even when it was started from the
  cube viewer.

### Fixed

- **Decimal values are stored correctly** — 15.5 no longer arrives as 155.
- **Editing a cell updates its totals** right away.
- **An element added in the dimension browser survives a write.**
- **"All" in the dimension browser now shows every element in the view.**
- **A large dimension no longer produces a giant expression** while only part of it is loaded.
- **Smaller views show all their rows** instead of stopping at 500.

## [1.0.28] — 2026-08-12

### New

- **MDX views and dynamic subsets carry a `{}` mark** — in the view dropdown, the subset
  dropdown and the tree (it replaces `ƒx`).
- **The process grouping panel shows a worked example per mode**, plus the mistakes each mode
  invites.

### Changed

- **Opening a large view moves far less data** — axis metadata is cut to what the grid can
  actually name, and row parents travel with the page they belong to.
- **The view list is sorted and complete the first time you open it**, with the open view
  preselected; opening the dropdown no longer jumps back to the top.
- **The MDX box no longer carries a comment header** — just the expression.

### Fixed

- **MDX entered in the dimension browser takes effect**, and drilling on top of it composes a
  compact expression.
- **`ElementAttrS`/`ElementAttrN` and their relatives need the hierarchy** — the linter used to
  accept forms TM1 rejects and flag correct ones; `AttrInsert`/`AttrDelete` never take one.

## [1.0.27] — 2026-08-11

### New

- **Group processes by pattern** — `s{n}_` covers `s001_`, `s002_`, …; everything outside the
  braces stays literal.
- **Process grouping has a panel** with a live preview, instead of the two-step quick pick.
- **New lint rule "V12 file path"** — warns in V12 mode when a file function reaches outside the
  database content directory.
- **The v12 warning for `ExecuteCommand` names its successor**, `ExecuteHttpRequest`.

### Changed

- **V12 mode switches itself on when the server is v12**, per process editor.

### Fixed

- **Removing every parameter of a process is saved now.**
- **A subset whose element list did not load completely can no longer be overwritten.**
- **A failed step during a dimension save stops the run** instead of building on a half-changed
  dimension.
- **Unsaved changes in the dimension editor survive closing the panel.**
- **The TI test helper process is removed even when the capture fails.**
- **A subset whose MDX rule could not be read is no longer shown as a static subset.**
- **The reference index says when it is incomplete**, instead of claiming "not referenced anywhere".
- **Server settings can be saved again** — an unconfigured parameter no longer fails with
  "Invalid ServerSettings property encountered in payload".
- **20 more server parameters reach the right place**, among them ports, LDAP, SSL and memory limits.
- **Server settings only offers what the server actually has**, unknown ones as "N/A" instead of
  an HTTP 400.
- **Parameters the server has but has not set are visible now** — 26 on 11.8, 10 on v12.
- **A parameter no longer appears twice** under its old and its new name.
- **No more v12 warnings on the 16 ODBC, sandbox and security-overlay functions that work on v12.**
- **Eight ODBC functions that do not exist in TM1 are gone** from autocomplete and signature help.

## [1.0.26] — 2026-08-08

### New

- **Sort a dimension by index** — "Index ↑/↓" in the Dimension Browser's sort dropdown.
- **The filter searches attribute values on large dimensions too.**
- **Large dimensions show their hierarchy again** — rows indent under a parent standing above them.
- **Links to the IBM function documentation follow your display language**, English for the rest.
- **Rule autocomplete offers ROUNDP** and six further functions IBM documents as rule-valid.

### Changed

- **Leaf cells in the Cube Viewer are tinted, consolidated ones set in bold** — the level shows
  without clicking, and the zebra stripes stay visible.
- **Collapsing a row in the Cube Viewer, and opening it again, no longer reloads the view.**
- **"Keep only" applies immediately** and leaves the rows in their axis order.
- **Refreshing a view re-reads a dimension's structure only when the server says it changed.**
- **Changing an axis, a filter or a context dimension in the Cube Viewer is about twice as fast.**
- **Dragging a dimension onto an axis now shows where it will land**, last position included.
- **Rearranging the axes of a saved view no longer reloads the grid.**
- **The decimal-separator button now works on whole numbers too.**
- **Confirmation dialogs behave the same everywhere** — Enter answers the focused button, Escape
  cancels, focus stays inside the dialog.
- **Deleting an element or a user now starts on "Cancel"**, so a stray Enter aborts.

### Fixed

- **The MDX bar describes the rows on screen** — it follows the table after every action, and
  running it returns what the table shows.
- **Typing in the filter no longer claims the view cannot be expressed.**
- **"N elements (Level 0)" filters by level, not by type**, so string elements stay in.
- **Picking "Default element" writes an expression that returns that element.**
- **Jumping into the Dimension Browser from a view's axis no longer saves the whole dimension.**
- **Expanding a row works on the first click and stays an expression.**
- **The expand marker shows wherever — and only where — something is below.**
- **"All" really resets on large dimensions and after "Top level only".**
- **A subset on a large dimension shows all of its members.**
- **Elements in a subset are no longer indented against ancestors the filter removed.**
- **Switching subsets no longer flashes a "filters cleared" notice.**
- **Searching by a displayed alias works on large dimensions**, and the alias stays visible.
- **Three functions that do not exist in TM1 are gone** — ELISDESC, ELISATTR and AttributeExists.
- **Closing a process or rule editor no longer discards unsaved work.**
- **Wide cube views load in bounded pages** — measured in cells, not rows, so 200 columns no longer
  pull two million cells at once.
- **Rule linting no longer floods the server** — at most four element loads run at a time.
- **Screen readers read the question when deleting a user or a group.**
- **Paged reads never send your credentials to another host.**

## [1.0.25] — 2026-08-06

### Changed

- **The MDX bar stays visible** and names the reason when no expression can be composed.
- **The English build is really English now** — TI function docs, snippet descriptions and the last
  manifest string no longer answer in German.

### Fixed

- **Sorting a hand-ordered list by "Hierarchy" no longer empties the expression**, which used to
  take every filter set afterwards with it.
- **"All" takes a single click again.**
- **"All" now really shows every element** instead of leaving the rows of the subset on screen.
- **Rows indent only against an ancestor standing above them**, in the cube viewer and in the
  dimension browser.

## [1.0.24] — 2026-08-06

### New

- **MDX views keep their display alias.** Picking an alias now writes it into the MDX itself, per
  dimension and per axis, so it survives saving and reopening — several dimensions on one axis can
  each show a different alias, or none.

### Changed

- **A running process no longer blocks the screen.** It shows up at the top of "Recent" in the TM1
  sidebar and in the status bar, with a stop button; only the result is still a message.
- **Sorting follows the alias you display.** With an alias shown, the list sorts by the alias, not
  by the element name — the saved dynamic subset too.
- **A loaded subset can be sorted again.** "Hierarchy" brings the stored order back untouched, and
  a dynamic subset keeps its sorting when saved.
- **The sort dropdown offers Hierarchy, Name A-Z/Z-A and now None** — level and type are what the
  N/C/S buttons and the level filter are for. A freshly opened dimension now starts on None instead
  of Hierarchy.
- **An opened dimension now reads `{TM1SUBSETALL([Dim].[Hier])}`** instead of being wrapped in
  HIERARCHIZE; the tree is still shown, and picking "Hierarchy" writes the HIERARCHIZE explicitly.
- **The TI test framework is described accurately.** Recording deploys and runs a copy of your
  process on the server: cell, dimension and attribute writes go to a log, but reads, view/subset
  calls and sub-processes run live.

### Fixed

- **Overwriting a cube view no longer risks losing it** — the view is updated in place instead of
  deleted and recreated, and a failed overwrite says the view is gone.
- **A saved view reopens with its alias and its row and column dimensions** — both were always stored
  correctly but never read back.
- **A view that would pull in a whole dimension is stopped before it runs**, naming the dimension,
  instead of freezing the editor on open.
- **The dimension browser opens under the alias the grid shows**, not under the element names.
- **Debugging a process runs against the server you started it from** — with two connections to the
  same host open, it could attach to the wrong one.
- **Enter can no longer confirm a delete you meant to cancel** — dialogs follow the focused button,
  and destructive ones start on "Cancel".
- **Paged requests refuse to follow a pagination link pointing at another host** — TM1 credentials
  never leave the server you configured.
- **A save that could not be verified says so** — a failed rollback, an unreachable compile check or
  an unreachable `CheckRules` no longer read as a clean save.
- **Parameters you typed survive a tab switch.**
- **A cube with views can no longer look empty.** If the view list cannot be read, the tree says so
  instead of showing nothing, and long lists are now read to the end.
- **Messages appear in the language VS Code is set to.** Some texts — the message log timeout among
  them — were always German.
- **Panels open in the window you opened them from** — dragging an editor into its own window and
  then, say, clicking a filter chip in the cube viewer no longer sent the panel back to the main
  window.
- **Sorting a large dimension by name no longer hides elements sitting under a collapsed branch.**
- **Sorting by Hierarchy and saving now produces a dynamic subset**, like the other sort options,
  instead of a fixed list — including dimensions where an element sits under more than one parent,
  which used to be reported as rows you had moved by hand.

## [1.0.23] — 2026-08-05

### New

- **A filtered subset stays dynamic.** Filtering, sorting, removing, adding and reordering rows in
  the dimension browser now save as one MDX expression instead of a frozen element list — so the
  subset follows the dimension as it grows.
- **Save a cube view as MDX** — a checkbox in the save dialog, ticked while no native view is loaded.

### Changed

- **The N/C/S quick filters save as a type rule**, so elements created later show up in the subset.
- **"Save as MDX" comes pre-ticked**, except when overwriting a subset that is static on the server.
- **Names sort the way TM1 sorts them**: case is ignored, umlauts come after Z.

### Fixed

- **Dragging rows past the edge of the list scrolls along**, and the insert line stays visible.
- **Ctrl+F no longer jumps away** from a selected word, waits for you to stop typing, and lands on
  the first hit in the section you are in.
- **A paused debugger stays where you scrolled** — the editor only moves on the next step.

## [1.0.22] — 2026-08-02

### Changed

- **The dimension browser is one window.** No second pane, no transfer arrows — the rows you see
  ARE the subset. Keep, Remove, All and Drill sit in the toolbar.
- **Order the rows by hand:** drag them, or right-click → "Insert above" / "Insert below" to paste
  copied element names at that position.
- **Picking a subset clears the filters**, so you see what you picked. Sorting is off while the
  rows carry their own order — that order is the subset.
- **Picking a subset now shows that subset** — its own order and its duplicates, static ones
  included, instead of only filtering the list.
- **An element may appear more than once in a subset**, the way TM1 stores it.
- **"Save subset…" prefills name and private/public** from the loaded subset; "Overwrite" stays
  unticked, so replacing one is still a deliberate click.
- **Large hierarchies load noticeably faster**, and evaluating an MDX expression no longer creates
  temporary subsets on the server.

### New

- **Several drill rules at once**, each staying dynamic when the subset is saved; the save dialog
  says which ones do.
- **The list is indented by its own structure**, so a hand-built selection reads as a tree.
- **Delete a single occurrence** of an element instead of every row carrying that name.

### Fixed

- **Overwriting a subset that a view uses works** — the save no longer deletes the subset first,
  which TM1 refuses for exactly those (`subset being used by view`).
- **A subset opens under the alias it was saved with**, and overwriting one no longer strips it.
- **Clicking a second subset of the same dimension switches to it** instead of staying on the first.
- **Overwriting a subset asks before flattening one whose state could not be read.**
- **Right-click actions no longer keep a loaded subset's old MDX armed** — expand-all, show
  parent(s) and collapse-all used to save the previous expression back.
- **"Element + leaves" saves as MDX**, and "Show parent" / "Show all parents" stay dynamic.
- **A subset keeps its stored member order on reload.**
- **Expanding a consolidation shows all its children**, not just the one already visible.
- **Marks and drill state no longer survive a hierarchy switch**, which could mark rows nobody
  clicked and write never-loaded children into a saved subset.
- **Cube viewer:** a member dragged above its parent stays put when that parent collapses,
  collapsing affects the block you clicked rather than every row with that name, and reordering
  dimensions is no longer discarded as "nothing changed".
- **A process that ends via `ProcessQuit` counts as finished** in the message-log call tree and
  statistics instead of hanging at "running".
- **Server health shows the session count** — the probe never worked and the field stayed blank.
- **The debugger no longer shows Prolog while the process has moved on.**
- **Dimension browser windows close when you disconnect the server.**

## [1.0.21] — 2026-07-29

### New

- Reorder process parameters with the ▲/▼ buttons — in the process editor and in template editing.
- Open the dimension editor straight from the dimension browser, on the hierarchy you are looking at.
- **Save a chore under a new name** with "Save as…". The copy is always created inactive, and only
  scheduled afterwards if the original was — so a copy never starts running behind your back.
- **Replace the selection in one step** in the dimension browser: the new ⇒ button between the two
  panes drops what is on the right and puts the marked elements there instead.
- **Dynamic subsets are marked as such** — in the tree, in the subset dropdown, and above the
  selection, where the MDX expression is now shown. Their members now appear in the selection right
  away, on opening and on picking one from the dropdown, instead of only filtering the left list.
- Explorer icons in the dimension browser toolbar; the dynamic-subset bar carries a bolt.
- **Saving a subset takes one click** — no second Save button at the bottom any more.

### Fixed

- **Saving a chore no longer leaves it empty or with every task twice** — clearing is verified now,
  and a save whose safety snapshot fails is refused instead of deleting blind.
- **Saving an unchanged chore no longer empties it**; a failed write is rolled back and reported.
- **A chore keeps its commit mode and schedule** — "Single commit" was written back as "Multiple
  commit", and every 5 minutes or every 3 hours became "daily".
- **Chore parameters:** ones differing only in capitalisation are no longer sent twice, one the
  process no longer has is dropped rather than rejected, and Save cannot be started twice at once.
- **Text in a numeric chore parameter is refused** instead of quietly replaced by the default.
- **Saving a chore without tasks needs confirming.**
- **The dimension browser no longer shows one subset's members under another's name.**
- **Changes made through the right-click menu survive saving a dynamic subset.**
- **A dynamic subset is no longer silently turned into a fixed list** — converting needs confirming.
- **A subset's MDX can no longer end up on a different subset.**
- **Subsets no longer disappear from the tree** when the query marking the dynamic ones is rejected,
  and long ones are read completely rather than one page deep.
- **Set expressions work regardless of capitalisation**, and `{ [Dimension].[Element] }` no longer
  fails with TM1 error 278.
- **Overview columns finish loading** — a failed lookup shows "—" instead of spinning forever.
- **Sorting:** RAM in the cube overview sorts by size instead of alphabetically, chore Frequency and
  Next run by time instead of by text, and rows without a value sort last.
- **Light themes are readable** — cell-trace panel, and the error banners in the process editor,
  rule editor and dimension browser.
- **"Recently opened" lists only processes that actually opened**, picks the right database when two
  connections share a gateway, and now also catches Ctrl+click, Find & Replace and debugger
  step-into.

## [1.0.20] — 2026-07-28

### New

- Delete dimensions, cubes and hierarchies straight from the explorer's right-click menu — with a
  confirmation, and with TM1's own reason if it refuses.
- Create a hierarchy from the explorer, without opening the dimension editor.

### Fixed

- Ctrl+Z now takes back the element qualifier in the rule editor, and Clear, history and snippets
  in the MDX runner.
- Control objects (`}Clients` and friends) no longer offer a Delete entry.
- "Clear MDX history" actually asks now — before, the button did nothing at all.
- Saving a process template without a name now says so instead of staying silent.
- Deleted objects vanish from autocomplete immediately, and a deleted cube closes its rule editor.

## [1.0.19] — 2026-07-26

### New

- **Datasource preview reads from the server:** previewing a `.txt`/`.csv` datasource no longer
  needs the file to be reachable from your machine — the TM1 server reads it and returns the
  first lines. The local read stays as a fallback.
- **Process editor — breakpoints:** remove a single breakpoint or all of them from the
  breakpoints overview, also during a running debug session.
- **Insecure connections need confirming:** saving a server on plain HTTP, or with certificate
  checking switched off, now asks first.

### Fixed

- **Process grouping — the right-click menu offered the wrong entry** (Configure instead of
  Reset and vice versa), above all with several servers.
- **Process grouping survives renaming a server.**
- **An empty grouping token means no grouping** again, not one group per process.
- **Security matrices can be saved.** Every permission change failed with "0 saved, 1 failed".
  Matrices whose control cube does not exist yet now say so.
- **Cell security builder works on TM1 v12** — the generated cube had its dimensions in the wrong
  order.
- **Datasource preview works on TM1 v12,** and a failed preview now says why.
- **Cancel only cancels your own run** — it could hit another VS Code window on the same server.
- **Names with quotes, `#`, `%` or spaces** no longer break REST calls.
- **Cube viewer:** picking a context element keeps all rows, and the choice survives a refresh.
- **Message Log Analysis** no longer drops runs from the call tree.
- **Save data on a server folder** uses the server you clicked.
- **Datasource preview** no longer garbles umlauts.
- **Cell trace** clears when you switch tabs.
- **Threads — Context column on CAM servers:** shows `vscode-tm1-ti/<version>` like everywhere
  else instead of a JSON fragment. As a side effect you can see which client version every
  session is running.
- **Threads:** timed-out logins are no longer listed as nameless `(session)` rows.
- **Server actions leave nothing behind:** SaveDataAll, Security Refresh and cube Save data used
  to create a permanent `}VSCode_*` helper process on the server. They now run without storing
  anything. Existing `}VSCode_*` objects from earlier versions can be deleted.
- **Failed server actions are reported:** these actions previously reported success even when the
  run aborted on the server.
- **Cancel works on TM1 v12:** cancelling a running process or chore had no effect there.

### Changed

- **Process grouping is per server only, and off by default** — a server groups its processes
  only once you set a marker. The `tm1.processGroupSuffix`/`Mode` settings are gone (an existing
  value moves to your servers once), and "Reset" is now "Remove Process Grouping".
- **Up to 80 % less data over the wire** — responses are compressed now. Noticeable over VPN or a
  slow link.
- **Cube viewer:** the context dropdown is searchable.
- **Message Log:** the table header stays put while scrolling, and Analyze is highlighted.
- **Processes and process folders** have their own tree icons.
- **"Find References" is now "Usage & Call Graph"** in the tree context menu — it opens the call
  tree for a process and the usage list for a cube or dimension.
- **Call graph — direction switch:** the Downstream/Upstream buttons became tabs in the style of
  the analysis panels, each labelled with its own count, so you can see at a glance whether the
  other direction has anything in it. The call-graph, usage and chore panels now share one
  toolbar layout, use the object explorer's icons for processes, rule cubes, subsets and views
  instead of coloured bullets, and are fully translated (they were German-only regardless of the
  UI language).
- **Cell trace (Calculation / Feeders / Check feeders):** the three traces now live in one panel
  per cell with a tab per mode — switching re-traces the same cell instead of sending you back to
  the cube viewer. The calculation tree aligns its value column across all levels and has
  expand/collapse all, the cell lists finally have column headers and counts, and "fed / not fed"
  is colour-coded. Coordinates moved to their own line so they no longer push the toolbar around.
- **TM1 v12:** SaveDataAll and cube Save data are hidden — the underlying TI functions do not
  exist in v12, which persists data on its own.

## [1.0.18] — 2026-07-24

### New

- **Message Log Analysis:** a new panel — the **Analyze** button in the Message Log, or the
  `TM1: Analyze Process Runs` command — reads the recent server message log and shows a process
  **call tree** (who ran whom, with inclusive/self runtime and %) plus a **per-process
  statistics** table (calls, total/avg/min/max runtime, failures). Sortable, with a depth
  selector. Available on TM1 v11 / Planning Analytics.

### Changed

- **No more execution timeout:** long-running processes, rule saves and views are no longer cut
  off after 30 seconds — they run as long as the server needs. Set `tm1.timeoutMs` above 0 if you
  want a fixed cap back.
- **Chore times in UTC:** chore start times are shown and saved in UTC, fixing wrong-hour and
  daylight-saving shifts.

### Fixed

- **Umlaut names in large responses:** fixed text corruption of multi-byte names in server
  responses larger than ~16 KB.
- **Faster "Save as new dimension":** saving a very large dimension from the editor no longer
  takes minutes (was quadratic; now near-instant).
- **Reliable dimension commits on TM1 11.8:** dimension and attribute saves no longer silently
  drop attribute values.

## [1.0.17] — 2026-07-21

### New

- **Panel-wide save:** `Ctrl/Cmd+S` in the process and rule editors now saves from any tab.
- **Create cube:** the dialog fills the window, the dimension list has a filter, and control
  dimensions can be toggled on (off by default).
- **Dimension browser:** open any number of dimensions in parallel.
- **Dimension editor — reorder:** drag an element onto the top/bottom edge of a row to reposition
  it under its consolidation; children now follow TM1 storage order and the order is saved.
- **Dimension editor — tree menu:** right-click for Add element / Add child / Paste (`Ctrl/Cmd+C`)
  as child or same level / Remove from this node / Delete. Elements under several consolidations
  now select only the clicked occurrence.
- **Dimension editor — Save as new dimension:** save the current editor state as a brand-new
  dimension.
- **Threads:** CAM-authenticated servers now show readable usernames.

### Fixed

- **Dimension editor:** save-path data-loss fixes when a reorder is combined with a type change,
  weight change, or newly-added elements; drag-move keeps the selection valid.

### Changed

- English users now see English error/status messages (previously some were German).

## [1.0.16] — 2026-07-20

### New

- **Process editor:** Ctrl/Cmd-click a process name in `ExecuteProcess` / `RunProcess` to jump
  straight to that process (works for literals and variables holding one).
- **Rule editor:** code-actions dropdown (indent / outdent / comment / uncomment) and a single
  **Format ▾** menu, matching the process editor.
- **Recent view:** shows process / rule icons, and records the thread monitor — click to reopen it.
- **Cube Viewer:** refreshed toolbar icons and a decimal-separator toggle.
- **Tree:** folder icons for folder-like nodes.

### Fixed

- **Cube Viewer:** expanding a node now shows its children directly underneath, instead of at the
  bottom of the dimension.
- **Recent view:** the thread monitor entry now actually appears.
- **Naming tools:** the progress bar no longer gets stuck when the server scan fails, and shows
  activity while scanning.
- **Editor:** function hover no longer misfires inside strings and comments; `ItemReject` is no
  longer flagged as being in the wrong section.
- **Cube Viewer:** CSV export writes a UTF-8 marker so Excel renders umlauts correctly.

### Security & hardening

- Server URLs with embedded credentials (`user:pass@host`) are rejected instead of stored in
  plain text.
- Sessions are keyed per password, so two profiles of the same user can no longer share — or
  tear down — each other's session.
- App links are restricted to `http(s)`; debug parameters named like secrets are redacted in
  the log.
- Previewing a local-file datasource asks first (the path can come from the server-side
  process); temporary file names from TM1 are sanitized.
- Packaging no longer ships development files or local config inside the VSIX.

### Performance

- Lighter large-dimension shift-select and read-only panels (less CPU / RAM).

## [1.0.15] — 2026-07-19

### Find & Replace tools (Processes) — new

A new **Find & Replace** submenu on the Processes node bundles three tools:

- **Find/Replace across Processes & Rules** — search and replace across many process and rule
  bodies at once; confirms before writing to TM1 and shows a hint before the first search.
- **Normalize Naming & Casing** — unify variable / parameter / datasource / function / keyword
  casing and naming conventions across your processes, in a guided **Step 1 / 2** flow.
- **Unify Variable Names** — find string variables that hold the same value under different
  names and unify them to one canonical name; split multi-value variables. Two tabs (Value
  names / Multi-value split), results grouped by process, and a **per-server exclude list**
  (glob, e.g. `sDim`, `*Dim`) to hide variable names you never want to touch.

### Process editor
- New-process wizard: **Enter steps through the tabs** — type a name, then Enter/Enter/Enter
  creates a default process.
- New **Code actions** toolbar dropdown: indent / outdent / comment / uncomment, each with its
  shortcut (including **Ctrl+#** on German keyboards).
- The Format button is now **Formatter ▾** — a dropdown with "Apply now" plus the formatter rules.
- **Run** and **Debug** now have keyboard shortcuts (Ctrl+F5 / F5), shown in their tooltips.

### Servers
- Reworked **Add server** flow: the URL is auto-completed to `https://` and validated, a live
  preview shows what it connects to, plain-HTTP and "Verify SSL" get inline explanations, and
  **Save is enabled only after a successful Test**.
- **Connect fallback**: if the test fails on a certificate or the wrong scheme, it retries once
  (accept the certificate / swap `http`↔`https`) and updates the form — never on a login error.
- Added **OIDC** issuer / client-ID fields for v12.

### Other
- **What's New**: after an update, a notice opens the release notes for the new version.

## [1.0.14] — 2026-07-16

### Cube viewer
- Cell selection shows a floating readout: a single cell's full-precision value
  (also on hover), or count/sum/average across a multi-cell selection.
- `Ctrl/Cmd+C` copies the selection's full-precision values as tab-separated text
  for Excel; decimal separator follows the OS locale (`tm1.cubeViewer.copyDecimalSeparator`).
- New toolbar controls: toggle decimal separator (point ↔ comma) and
  increase/decrease displayed decimals; values reformat live from the raw value.
- Editing a cell now seeds and writes the real raw value; an untouched cell no
  longer triggers a write (fixes a spurious consolidated-cell error).

### Process run
- A run finishing with minor errors is reported as a warning, not a success;
  every error offers an "Open Error Log" button — even before the Message Log
  panel was ever opened. Recovers the newest error log for the exact process
  (matched by timestamp + pid, not just the name suffix).
- The result notification shows the exact status code (`HasMinorErrors`,
  `Aborted`, …) and, for minor runs, the error count.

### Fixes
- Connecting to a server returning HTTP 503 shows a plain "not ready" hint
  instead of a raw HTTP error; no automatic retry/reconnect.
- Overview + Message Log: horizontal scrollbar pinned to the viewport.
- Cube overview: dimensions column wraps instead of overflowing.
- Process editor: breakpoints follow their line on insert/delete above them.
- TI linter: "undefined variable" warning points at the real usage line.
- Cube viewer: re-saving a view pre-selects its prior private/public choice.

## [1.0.13] — 2026-07-15

### Object overview pages
- New category-wide overview webviews for **Processes**, **Dimensions**, and
  **Cubes** — right-click a tree category → *Overview*. Each is a sortable,
  filterable table with KPI tiles, tailored to its object type: processes show
  datasource, used sections, and a sub-process call graph (calls / called-by);
  dimensions list hierarchies, attributes, and the cubes that use them; cubes
  show dimensions, rules/feeders, view count, and RAM/cells.
- Cheap metrics paint instantly; expensive ones (RAM/cells, attributes,
  cube usage, last run) stream in afterwards. Control objects (`}`-prefixed)
  are hidden behind a toggle. The header shows the server display name.
- Click a badge (e.g. a cube's dimension) to filter the table to rows that
  contain it; a chip clears the filter. Row click opens the object's editor —
  dimensions open the read-only viewer. Process *Last run* reads the last
  execution end time from `}StatsByProcess`.

### Process & rule editor
- Deleting a process now closes its open editor window.
- The process editor remembers scroll position per section (Prolog / Metadata /
  Data / Epilog) when switching tabs.
- The rule editor gained the process editor's Ctrl+F / Ctrl+H match list.

## [1.0.12] — 2026-07-13

### Cross-object Find & Replace
- Search and replace across all processes and rules from the Processes folder /
  server-root menu. Preview webview with per-match checkboxes, case-insensitive
  matching, and object-kind + name prefix/suffix filters. Click a result to open
  its editor and jump straight to the matched line.

### References / usage graph
- Subset and MDX-view references are now folded into the usage graph; click a
  usage entry to open the subset or view. Per-view fetch is bounded and isolated
  to avoid fan-out on large models; usage groups collapse by default with
  cleaner labels.

### Git integration
- Simplified to a blind pull/push model: the manifest baseline and
  drift-on-open tracking (and their prompts/counters) have been removed.

### Editor & tree
- Reliable Ctrl+X cut in the Monaco editors; correct ASCIIOutput/TextOutput
  argument types.
- Hide the Rules node for cubes that have no rules.
- Show "Manage Databases (Root)" only on v12 servers.

### Fixes & hardening
- Dispose webview-panel listeners on close (memory-leak fix).
- Two-day review batch: find/replace data-loss guard, git-pull safety,
  CSP migration (no remaining `unsafe-inline`), dompurify 3.4.12 override,
  completion-parse memoization, awaited session shutdown, i18n cleanup.

### TI test framework & simulator
- Simulates processes that read cells/attributes at variable-built coordinates:
  such reads (and dims/cubes used in `IF`/`WHILE` guards) are captured at run
  time and replayed; warnings flag incomplete captures.
- Wider function coverage; 1960 date epoch (`DAYNO`/`DATE`/`TIMVL`); `\` is real
  division (0 on ÷0) in both parser and simulator, and `\`/`-` continue lines.

## [1.0.11] — 2026-07-10

### Server activity monitor
- New **Session** column: shows each thread's stable login-session ID (read from
  `Thread.Session`), the constant identifier while the thread ID rotates per
  request. Idle logins are listed too (hidden by the "active only" toggle).
- **v12** support: sources running work from `/Jobs` (the "Activity" model) —
  a running process now shows as an active row with its user, session and
  elapsed time; cancel targets the Job. Job lock-wait chains are rendered.
  The view says "Jobs" throughout on v12, "Threads" on v11. v12 Int64 session
  ids are kept lossless (shown exactly, not rounded by JSON parsing).

### Fixes
- Chores: numeric task parameters are now sent as JSON numbers (TM1 rejects a
  string value with a parameter-mismatch error); an empty numeric field falls
  back to the process default and an empty string is allowed — fixing the error
  when a task parameter was left blank.
- Security Refresh runs as a TI helper process (the `POST /SecurityRefresh`
  REST action does not exist on TM1 11.x and returned HTTP 400).

## [1.0.10] — 2026-07-10

### Fixes
- Delete-server button stays readable on hover in light theme.
- Process/rule editor no longer opens blank on a fast webview load (`monacoReady` race).
- Undefined-variable linter anchors to the real usage line, not a text match.

### TI language
- `AsciiOutputOpen` param 2 renamed `AppendFlag` → `OpeningMode` (0–3); `FILE_OPEN_APPEND()` / `FILE_OPEN_SHARED()` now recognized.
- Client/group security functions no longer flagged `wrong-section` in Data/Epilog (`ItemSkip` / `ItemReject` stay restricted).

### Cube viewer
- Saving over an existing view defaults the public/private toggle to how it was saved.

## [1.0.9] — 2026-07-09

### Cube viewer
- New ▼ filter icon on context (title) dimensions: opens the dimension browser
  to curate which elements the dropdown offers (like the row/column filter).
  Native views persist the restriction as a title subset and restore it on
  reopen (verified live, TM1 11.8); MDX views apply it as a runtime-only filter.

### Fixes
- Saving an MDX view no longer silently converts it to a native view.
- Native/MDX view type is now read from `@odata.type` instead of a probe that
  400s on native views — fixes "MDX empty" on Save and a wrong tree/viewer
  type; type is re-read on every view switch (no leak between views in a panel).
- Moving a context dim onto a row/column axis carries only the selected element
  instead of expanding the whole list (no more long load); dropping an axis
  chip onto itself is a no-op.
- Tree: a cube dimension node opens the browser on single click (security-menu
  parity).
- Deleting a server refreshes the TM1 explorer immediately.

### Performance
- Native-view axis-config reads run in parallel on open/switch.

## [1.0.8] — 2026-07-08

### Applications (new)
- Rename, move (folder picker / root), and toggle public↔private for any entry,
  from the tree context menu. Runs through the TM1 `tm1.Move` action (the earlier
  "rename impossible via REST" note was wrong). Verified live on TM1 11.8.

### Debug variables panel (new)
- Docked panel during TI debug: live variable values, changed-first sort,
  filter, no-wrap values. DE/EN.

### Fixes
- mdx: forward `@odata.nextLink` verbatim — v12 paging no longer truncates.
- mdxPopup: force textarea EditContext so webview keydown guards stop swallowing input.
- linter: `Hierarchy*` InsertionPoint is a string, not numeric.
- webview lifecycle: close panels on server disconnect; guard post-to-disposed.
- messageLog: open error logs read-only; linkify names with spaces/special chars.
- dimBrowser: selected-pane MDX forest via iterative build.

## [1.0.7] — 2026-07-05

### Cell Trace (new)
- Trace a cell from the Cube Viewer context menu: rule calculation, feeders, and
  check-feeders open in a dedicated panel with a component tree and a labelled
  rule/feeder statement table (DE/EN).
- Click a rule/feeder line number to open the Rule Editor at that line; empty
  cells show a hint instead of a blank trace.
- Reliability: a superseded or disposed trace no longer overwrites the panel
  (request-sequence guard). Element/dimension names containing `/` are
  URL-encoded in the trace request path (previously broke or mis-targeted).

### Process Editor & Git mirror
- Process "Security access" (`HasSecurityAccess`) is now editable end-to-end.
- Git mirror exports the process header as `<name>.json`, aligned to the TM1
  REST/OData shape.
- Mirror manifests migrate v1 → v2: stale drift baselines (from an older
  serializer) are reset and re-baselined on the next pull, ending false
  "diverged" warnings.

### Dimension Browser
- Collapse-all now works on paged (100k+) dimensions.
- Drill-to-level is scoped and reliable (resolved server-side via MDX).
- A stale subset-MDX response can no longer overwrite the current filter after a
  dimension/hierarchy switch; empty results show a hint banner.
- Collapse-all / top-level clears active quick-filters (with a one-time hint)
  instead of showing a silently empty table.

### Tree & Bedrock
- Bedrock install is scoped to the `}bedrock.*` control-object library only.
- Refresh Explorer invalidates the object-name cache and re-lints open documents,
  so objects added on the server appear without a reconnect.

### Reliability
- OData error messages are extracted uniformly across both wire shapes (plain
  string and `{ value }`), fixing `[object Object]` in cell-trace and
  dimension-editor error text.
- The MDX element cache is bounded (LRU cap) to keep memory in check on large
  dimensions.
- Error banners are readable in both light and dark themes.

## [1.0.6] — 2026-07-04

### TM1 v12 / Planning Analytics Engine
- Connect to PA Engine (v12) with service-to-service (S2S) credentials
  (App-Client ID / Secret), basic-native, and OIDC PKCE helpers.
- Management-plane discovery of instances/databases in the add-server flow;
  inline database management (list / create / delete) from the server webview.
- v12-aware Threads (populated from Sessions) and message-log notices where a
  read is unavailable on v12.

### Reliability — race protocols
- Dimension Browser and Cube Viewer responses now carry request identity:
  a stale element/attribute/subtree payload or cell page from a superseded
  request can no longer overwrite the current selection after a dim/hier/view
  switch.
- MDX Runner and Dimension Browser init use a `webviewReady` handshake instead
  of a timing guess — prefill/selection config is no longer lost on a slow load.
- Cube Viewer recovers from an expired (idle-session) cellset instead of freezing
  paging on a 404.

### Type-safety & memory
- Centralized `parseBody` / `parseBodySafe` (parse **and** release the raw HTTP
  body) with typed OData/cellset shapes; broad body-release coverage for large
  (10+ MB) payloads, plus release added to previously-leaking caches. A guard
  test locks the pattern.

### UX
- Threads: active-only filter. Dimension Browser: alias submenu, source-pane
  collapse-all / roots-only.
- Connect-error notifications follow the VS Code display language.
- Removed default keybindings that shadowed core VS Code shortcuts
  (`Ctrl+Shift+E` etc.); the commands remain in the Command Palette and context
  menus.

## [1.0.5] — 2026-07-01

- **Applications explorer** — merged public + private tree; open/download
  documents, open links, create folder / link / reference, upload document, and
  delete, all via REST.
- **Tree** — left-click a dimension opens the element browser; optional server
  folders for grouping; expansion state resets on reconnect.
- **Cube Viewer** — NON EMPTY sync between inserted MDX and suppression.
- **Message Log** — clickable error-log filenames open their content in an editor.
- Settings cleanup — dropped server-level keys from the extension settings.

## [1.0.4] — 2026-06-30

- **Dimension Browser (selected pane)** — per-occurrence positional
  expand/collapse with explicit depth; subset build de-dupes duplicate
  occurrences; outline-safe reorder/drag; show-(all)-parents builds a
  per-occurrence outline; paged-drill fixes.
- **Tree** — toggle process-grouping (Configure / Reset).
- **Control objects** — show/hide with active-status security labels.
- **Formatter** — inline `IF(cond,t,f)` is no longer counted as a block opener.

## [1.0.3] — 2026-06-28

- **Leaf semantics** — "Leaves" = level-0 descendants (TM1 semantics), resolved
  server-side; Expand-all resolves the full subtree server-side.
- **Context menus** — unified expand-fully / show-only-this / children / parents
  across Cube Viewer and Dimension Browser; removed redundant Show-descendants /
  Show-children.
- **Source pane** — Ctrl/Shift multi-select with context actions; paged-
  consolidation drilling fixes; per-occurrence multi-parent trees.

## [1.0.2] — 2026-06-26

- Packaging metadata (`repository` field) and release plumbing.

## [1.0.1] — Initial release

First release of the TM1 IDE extension.

### Highlights
- **TI editor** — syntax highlighting, snippets, rules + TI autocomplete,
  configurable linter (N/D/S rules, per-instance config), formatter,
  and folding.
- **Process tooling** — deploy, execute, debug, and cancellable execution
  (server-thread cancel); `.pro` datasource configuration.
- **Cube Viewer** — Monaco-based, write-back, spreading, cell-scroll paging,
  and per-dimension display aliases for rows/columns.
- **Dimension Editor & Browser** — large-dimension support with server-side
  level/attribute filters, virtualized panes, and paging.
- **MDX Runner** — autocomplete, validation, cell-limit guard.
- **Rule Editor** — autocomplete and linting for cube rules.
- **Chores** — management and cancellable execution.
- **TM1 Security Manager** — users, groups, and object permissions.
- **TI Test Framework** — record-and-replay testing without cube mutation.
- **Git integration** for TM1 objects.
- **Server management** — multi-server profiles, session reuse, health,
  threads, message log, and a database configuration editor.
- **Create Dimension / Create Cube** commands.
