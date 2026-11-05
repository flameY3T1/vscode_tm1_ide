/** All inline CSS for the Cube Viewer webview.
 *  Architect-inspired styling: spreadsheet-feel, slot-style title bar,
 *  zebra rows, tabular numerals, distinct consolidation rows. */
import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';

export const CUBE_VIEWER_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cv-grid-line: var(--vscode-editorGroup-border, rgba(128,128,128,0.18));
      --cv-grid-line-strong: var(--vscode-panel-border, rgba(128,128,128,0.45));
      --cv-header-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --cv-header-fg: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
      --cv-zebra: rgba(127,127,127,0.04);
      --cv-row-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.10));
      /* Tint of the leaf cells. Mixed from the foreground color instead of being
         set as a fixed grey: on light themes this yields black-on-white, on dark
         ones a lightening. A fixed rgba(127,127,127,…) is barely readable on a
         dark background. */
      --cv-leaf-bg: color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
      /* Tint of the rule-derived cells. Mixed from the theme's chart yellow, not
         set as a fixed yellow: the themes already supply a tone here that stays
         readable on light and dark backgrounds alike. 12 % is deliberately
         faint — the coloring is meant to mark the area, not to drown out the
         number in it. */
      --cv-rule-bg: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 12%, transparent);
      --cv-accent: var(--vscode-focusBorder, #007acc);
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }

    /* ── Action bar (top): refresh, view picker, save, export, suppress ── */
    .action-bar {
      display: flex; align-items: center; flex-wrap: wrap;
      gap: 6px; padding: 4px 10px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--cv-grid-line-strong);
      flex-shrink: 0; min-height: 34px;
    }
    .action-spacer { flex: 1; }

    /* ── Title bar (context dims) ── */
    .title-zone {
      display: flex; align-items: center; flex-wrap: wrap;
      gap: 8px; padding: 6px 10px;
      background: var(--cv-header-bg);
      border-bottom: 1px solid var(--cv-grid-line-strong);
      flex-shrink: 0; min-height: 34px;
    }

    /* ── Axis bar (rows / cols slots) — cols aligned with grid data column start ── */
    .axis-bar {
      display: flex; align-items: stretch;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--cv-grid-line-strong);
      flex-shrink: 0; min-height: 36px;
    }
    .axis-zone {
      display: flex; align-items: center; flex-wrap: wrap;
      gap: 4px; padding: 4px 10px; min-width: 0;
    }
    .axis-zone-rows {
      width: var(--cv-rows-zone-w, 240px); flex: 0 0 auto;
    }
    .axis-zone-cols { flex: 1 1 auto; }
    /* Toned down since the placeholder (.drop-ghost) shows the position —
       the zone now only says "in here", no longer "somewhere in here". */
    .axis-zone.drag-over, .title-zone.drag-over {
      background: color-mix(in srgb, var(--cv-accent) 8%, transparent);
      outline: 1px solid color-mix(in srgb, var(--cv-accent) 45%, transparent);
      outline-offset: -1px;
    }
    .zone-sep {
      width: 1px; background: var(--cv-grid-line);
      margin: 5px 0; flex-shrink: 0;
    }
    /* The divider between the row and column zones carries the swap button:
       the divider stays as a line above and below the button. */
    .zone-sep-swap {
      display: flex; flex-direction: column; align-items: center;
      flex-shrink: 0; margin: 5px 0; gap: 3px;
    }
    .zone-sep-swap::before, .zone-sep-swap::after {
      content: ''; width: 1px; flex: 1; background: var(--cv-grid-line);
    }
    button.swap-axes-btn { padding: 2px 4px; min-width: 0; }
    button.swap-axes-btn .btn-icon { margin: 0; }
    .zone-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      color: var(--vscode-descriptionForeground); letter-spacing: 0.08em;
      white-space: nowrap; margin-right: 6px; flex-shrink: 0; user-select: none;
    }
    .suppress-group {
      display: flex; align-items: center; gap: 8px;
      flex-shrink: 0;
    }
    .numfmt-group {
      display: inline-flex; align-items: center; gap: 2px;
      flex-shrink: 0;
    }
    /* .icon-btn sets display:inline-flex, which beats the hidden attribute. */
    .numfmt-group [hidden] { display: none !important; }
    .numfmt-group .btn-secondary {
      min-width: 30px; padding: 2px 6px; font-variant-numeric: tabular-nums;
    }
    .suppress-label {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11px; color: var(--vscode-descriptionForeground);
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .suppress-label input[type=checkbox] { cursor: pointer; margin: 0; }

    /* ── Toolbar icon buttons (Refresh, Save View, Format etc.) ── */
    .icon-btn { display: inline-flex; align-items: center; gap: 6px; }
    .btn-icon { width: 14px; height: 14px; flex-shrink: 0; pointer-events: none; }
    .btn-icon.dark-only { display: none; }
    body.vscode-dark .btn-icon.light-only,
    body.vscode-high-contrast:not(.vscode-high-contrast-light) .btn-icon.light-only { display: none; }
    body.vscode-dark .btn-icon.dark-only,
    body.vscode-high-contrast:not(.vscode-high-contrast-light) .btn-icon.dark-only { display: inline-flex; }

    /* ── Chips (axis dim slots) ── */
    .dim-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 6px 2px 9px;
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      font-size: 11px; font-weight: 500;
      cursor: grab; user-select: none;
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      white-space: nowrap;
      transition: border-color 0.1s, background 0.1s;
    }
    .dim-chip:hover { border-color: var(--cv-accent); }
    .dim-chip.dragging { opacity: 0.35; cursor: grabbing; }
    .dim-chip.has-selection {
      border-color: var(--cv-accent);
      background: color-mix(in srgb, var(--cv-accent) 14%, var(--vscode-input-background));
    }
    /* Insertion marker while dragging: shows the future position in the
       axis order. As wide as its content, hence no width animation. */
    .drop-ghost {
      display: inline-flex; align-items: center;
      padding: 2px 6px 2px 9px;
      font-size: 11px; font-weight: 500;
      white-space: nowrap; pointer-events: none;
      color: var(--cv-accent);
      border: 1px dashed var(--cv-accent);
      border-radius: 3px;
      background: color-mix(in srgb, var(--cv-accent) 10%, transparent);
    }
    .chip-x {
      font-size: 13px; line-height: 1; cursor: pointer;
      opacity: 0.55; padding: 0 2px; border-radius: 2px;
    }
    .chip-x:hover { opacity: 1; background: rgba(127,127,127,0.18); }
    .title-x { display: inline-flex; align-items: center; padding: 0 5px; border-radius: 0; }
    .chip-add {
      font-size: 13px; line-height: 1; cursor: pointer;
      opacity: 0.55; padding: 0 2px; border-radius: 2px;
    }
    .chip-add:hover { opacity: 1; background: rgba(127,127,127,0.18); }
    /* A chip never gets wider than its zone: name and hierarchy picker both
       give way, and the buttons wrap to a second line. A picker that kept
       its width (long alternative hierarchy name, narrow row headers)
       spilled over the swap button into the columns zone. */
    .dim-chip { max-width: 100%; min-width: 0; flex-wrap: wrap; }
    .chip-label { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    .chip-name { min-width: 2.5em; overflow: hidden; text-overflow: ellipsis; }
    .chip-hier {
      font: inherit; font-size: 11px; padding: 0 2px; flex: 0 1 auto; min-width: 3em;
      text-transform: none; letter-spacing: normal; font-weight: 400;
      color: inherit; background: transparent;
      border: 1px solid rgba(127,127,127,0.35); border-radius: 2px;
    }
    .chip-filter {
      font-size: 9px; line-height: 1; cursor: pointer;
      opacity: 0.55; padding: 0 2px;
    }
    .chip-filter:hover { opacity: 1; }
    .dim-chip.has-selection .chip-filter {
      opacity: 1; color: var(--cv-accent);
    }

    /* Title slots — label-prefixed dropdowns (Architect "Page bar" feel) */
    .title-chip-group {
      display: inline-flex; align-items: stretch;
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      overflow: hidden;
      background: var(--vscode-input-background);
    }
    .title-dim-label {
      display: inline-flex; align-items: center;
      padding: 2px 8px;
      background: color-mix(in srgb, var(--cv-grid-line-strong) 35%, transparent);
      color: var(--vscode-descriptionForeground);
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em;
      cursor: grab; user-select: none; white-space: nowrap;
      border-right: 1px solid var(--cv-grid-line-strong);
    }
    .title-dim-label:hover {
      background: color-mix(in srgb, var(--cv-accent) 22%, transparent);
      color: var(--vscode-foreground);
    }
    .title-dim-label.dragging { opacity: 0.35; }
    .title-filter {
      display: inline-flex; align-items: center;
      padding: 0 5px;
      font-size: 9px; line-height: 1; cursor: pointer;
      opacity: 0.6; user-select: none;
      color: var(--vscode-descriptionForeground);
      border-right: 1px solid var(--cv-grid-line-strong);
    }
    .title-filter:hover {
      opacity: 1; background: rgba(127,127,127,0.18);
    }
    .title-chip-group.has-selection .title-filter {
      opacity: 1; color: var(--cv-accent);
    }
    /* The native select stays as the value carrier (every reader queries
       .title-elem-sel) but is never shown — .title-combo renders on top of it
       because a native option list cannot be filtered. */
    .title-elem-sel { display: none; }
    ${FILTER_COMBO_CSS}
    #view-select { display: none; }
    .action-bar .title-combo-btn {
      border: 1px solid var(--cv-grid-line-strong); border-radius: 3px;
      max-width: 200px;
    }

    /* ── Buttons (toolbar) ── */
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; padding: 4px 11px; border-radius: 3px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      white-space: nowrap; line-height: 1.3;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--cv-grid-line-strong);
    }
    .btn-secondary:hover {
      background: color-mix(in srgb, var(--cv-accent) 10%, transparent);
      border-color: var(--cv-accent);
    }
    .toggle-btn[aria-pressed="true"] {
      background: color-mix(in srgb, var(--cv-accent) 22%, transparent);
      border-color: var(--cv-accent);
      color: var(--vscode-foreground);
    }
    .toggle-btn[aria-pressed="true"]:hover {
      background: color-mix(in srgb, var(--cv-accent) 32%, transparent);
    }
    /* Multi-selected row-label / column-header cells */
    .header-selected {
      background: color-mix(in srgb, var(--cv-accent) 22%, var(--cv-header-bg)) !important;
      box-shadow: inset 0 0 0 1px var(--cv-accent);
    }

    .cell-count {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; font-variant-numeric: tabular-nums;
      padding: 0 8px; border-left: 1px solid var(--cv-grid-line);
      margin-left: 4px;
    }

    /* Bottom status bar — always present (fixed height) so selecting a cell
       never resizes the grid; sits below the grid, never overlaps it. */
    #cell-value-pop {
      flex-shrink: 0;
      height: 22px; line-height: 22px;
      padding: 0 12px;
      border-top: 1px solid var(--cv-grid-line);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      font-size: 12px; font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* ── Loading / Error / Placeholder ── */
    #loading {
      display: flex; align-items: center; justify-content: center;
      padding: 40px; color: var(--vscode-descriptionForeground); flex: 1;
    }
    .spinner {
      width: 16px; height: 16px; margin-right: 10px;
      border: 2px solid var(--cv-grid-line);
      border-top-color: var(--cv-accent);
      border-radius: 50%; animation: spin 0.85s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #error-banner {
      display: none; margin: 8px 10px; padding: 8px 12px;
      background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 10%, transparent);
      border-left: 3px solid var(--vscode-errorForeground, #f48771);
      border-radius: 2px;
      color: var(--vscode-errorForeground, #f48771); font-size: 12px;
    }
    #warn-banner {
      display: none; padding: 5px 12px;
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 8%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 30%, transparent);
      color: var(--vscode-editorWarning-foreground, #cca700);
      font-size: 11px; flex-shrink: 0;
    }
    #placeholder {
      display: flex; align-items: center; justify-content: center;
      padding: 40px; color: var(--vscode-descriptionForeground);
      font-style: italic; flex: 1;
    }

    /* ── Grid (Architect-style spreadsheet) ── */
    #grid-container { flex: 1; overflow: auto; background: var(--vscode-editor-background); }
    .cube-table {
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--vscode-font-size);
      white-space: nowrap;
      min-width: 100%;
      /* Suppress native text-selection so cell-range selection (drag) does not
       * paint a blue text highlight over the grid, and Ctrl+C copies the raw
       * values via our own handler rather than the formatted DOM text. */
      user-select: none;
      -webkit-user-select: none;
    }
    .cube-table th {
      position: sticky; top: 0; z-index: 5;
      background: var(--cv-header-bg);
      color: var(--cv-header-fg);
      font-size: 11px; font-weight: 600;
      padding: 4px 10px;
      border-bottom: 2px solid var(--cv-grid-line-strong);
      border-right: 1px solid var(--cv-grid-line);
      text-align: right;
    }
    .cube-table th[data-dim-name]:hover {
      background: color-mix(in srgb, var(--cv-accent) 10%, var(--cv-header-bg));
      color: var(--vscode-foreground);
    }
    /* Column resize grab-handle on the right edge of header cells. Anchors to
       the (position:sticky → positioned) th / row-label / corner box. */
    .col-resizer {
      position: absolute; top: 0; right: 0; width: 6px; height: 100%;
      cursor: col-resize; z-index: 6; user-select: none;
    }
    .col-resizer:hover { background: var(--cv-accent, var(--vscode-focusBorder)); opacity: 0.5; }
    .rowdim-head { font-weight: 600; opacity: 0.85; }
    .cube-table th.row-header-corner {
      position: sticky; top: 0; left: 0; z-index: 10; text-align: left;
      background: var(--cv-header-bg);
      color: var(--vscode-descriptionForeground);
      font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.06em;
      border-right: 1px solid var(--cv-grid-line-strong);
    }
    .cube-table td {
      padding: 2px 10px;
      border-bottom: 1px solid var(--cv-grid-line);
      border-right: 1px solid var(--cv-grid-line);
      line-height: 1.4;
    }
    /* Zebra striping — subtle, only on data cells (row-label kept solid for sticky).
       Zebra, hover and consolidation tint are ALL translucent layers
       and are stacked as background-image instead of replacing one another
       as background-color — otherwise the tint swallows the zebra (and vice versa). */
    .cube-table tbody tr:nth-child(even) td:not(.row-label) {
      background-image: linear-gradient(var(--cv-zebra), var(--cv-zebra));
    }
    .cube-table tbody tr:hover td {
      background-image: linear-gradient(var(--cv-row-hover), var(--cv-row-hover));
    }
    .cube-table td.row-label {
      position: sticky; left: 0; z-index: 3;
      background: var(--vscode-editor-background);
      font-weight: 500; text-align: left;
      border-right: 2px solid var(--cv-grid-line-strong);
      min-width: 140px; max-width: 300px;
      cursor: context-menu;
      color: var(--vscode-foreground);
    }
    /* Sticky cells MUST stay fully opaque or data scrolled underneath shows
       through. --cv-zebra / --cv-row-hover are translucent rgba tokens, so we
       paint a SOLID background-color and lay the tint on top as a
       background-image. A bare color in the background shorthand image slot
       is dropped by the renderer, leaving a transparent sticky cell. */
    .cube-table tbody tr:nth-child(even) td.row-label {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(var(--cv-zebra), var(--cv-zebra));
    }
    .cube-table tbody tr:hover td.row-label {
      background-color: var(--vscode-editor-background);
      background-image: linear-gradient(var(--cv-row-hover), var(--cv-row-hover));
      box-shadow: inset 2px 0 0 var(--cv-accent);
    }

    /* ── Context menu ── */
    #ctx-menu, #ctx-spread-menu {
      display: none; position: fixed; z-index: 2000;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--cv-grid-line-strong));
      border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      min-width: 200px; padding: 4px 0;
    }
    .ctx-item {
      padding: 6px 14px; cursor: pointer;
      font-size: var(--vscode-font-size);
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
    }
    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
    .ctx-item.ctx-disabled { opacity: 0.4; pointer-events: none; }
    .ctx-item.ctx-has-submenu { position: relative; padding-right: 22px; }
    .ctx-submenu-arrow { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.7; display: none; }
    .ctx-item.ctx-has-submenu.ctx-multi .ctx-submenu-arrow { display: inline; }
    .ctx-submenu {
      display: none; position: absolute; left: 100%; top: -5px;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--cv-grid-line-strong));
      border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      min-width: 180px; max-height: 320px; overflow-y: auto; padding: 4px 0; z-index: 2001;
    }
    .ctx-item.ctx-has-submenu.ctx-multi:hover > .ctx-submenu,
    .ctx-item.ctx-has-submenu.ctx-multi.ctx-submenu-open > .ctx-submenu { display: block; }
    .ctx-submenu-item {
      padding: 6px 14px; cursor: pointer;
      font-size: var(--vscode-font-size);
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      white-space: nowrap;
    }
    .ctx-submenu-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
    .ctx-sep {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, var(--cv-grid-line));
      margin: 4px 0;
    }

    /* ── Cell value classes ── */
    .cube-table td.cell-numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .cube-table td.cell-zero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--vscode-descriptionForeground);
    }
    .cube-table td.cell-empty { text-align: right; }
    .cube-table td.cell-string { text-align: left; }
    /* An empty STRING cell (data-str set in gridCells) stays left-aligned: the
       picklist select inherits text-align and otherwise opened right-aligned
       until the first value was written. */
    .cube-table td.cell-empty[data-str="1"] { text-align: left; }
    .cube-table td.cell-rule {
      font-style: italic;
      cursor: not-allowed;
    }
    /* Consolidation = bold, otherwise plain; the leaf gets the FILL. In the viewer
       one works mostly on consolidations — the tinted class has to be
       the rarer one, otherwise the tint no longer marks anything. The tint sits
       as a layer of its own ABOVE zebra or hover, so that both signals stay
       readable side by side; the combination rules need the same specificity as the
       zebra/hover rules and therefore have to stand here, after them.
       Rule-derived cells carry their own yellow tint instead of the leaf tint —
       the rule origin is the more important information in the viewer, and two tints
       on top of each other would yield a third color that means nothing. */
    .cube-table td.cell-consolidated { font-weight: 600; }
    .cube-table td.cell-leaf {
      background-image: linear-gradient(var(--cv-leaf-bg), var(--cv-leaf-bg));
    }
    .cube-table tbody tr:nth-child(even) td.cell-leaf {
      background-image:
        linear-gradient(var(--cv-leaf-bg), var(--cv-leaf-bg)),
        linear-gradient(var(--cv-zebra), var(--cv-zebra));
    }
    .cube-table tbody tr:hover td.cell-leaf {
      background-image:
        linear-gradient(var(--cv-leaf-bg), var(--cv-leaf-bg)),
        linear-gradient(var(--cv-row-hover), var(--cv-row-hover));
    }
    /* Rule tint. Same specificity as the leaf rules above, so the order
       decides — and that is why these three rules must stand AFTER
       them: a cell carries both classes when it is a rule-derived
       leaf, and then yellow is supposed to win. */
    .cube-table td.cell-rule {
      background-image: linear-gradient(var(--cv-rule-bg), var(--cv-rule-bg));
    }
    .cube-table tbody tr:nth-child(even) td.cell-rule {
      background-image:
        linear-gradient(var(--cv-rule-bg), var(--cv-rule-bg)),
        linear-gradient(var(--cv-zebra), var(--cv-zebra));
    }
    .cube-table tbody tr:hover td.cell-rule {
      background-image:
        linear-gradient(var(--cv-rule-bg), var(--cv-rule-bg)),
        linear-gradient(var(--cv-row-hover), var(--cv-row-hover));
    }
    .cube-table td.cell-locked { cursor: not-allowed; opacity: 0.7; }
    /* Picklist arrow: permanently visible, drawn via ::after — no
       additional column width, otherwise the layout jumps compared to cells
       without a list. No character in the cell value: it stays copyable and the
       number formatting untouched. */
    .cube-table td.cell-picklist { position: relative; padding-right: 14px; }
    .cube-table td.cell-picklist::after {
      content: '\\25BE';
      position: absolute;
      right: 3px; top: 50%; transform: translateY(-50%);
      font-size: 9px; line-height: 1; opacity: .55;
      pointer-events: none;
    }
    /* Range selection — Architect-style accent fill */
    .cube-table td.cell-selected {
      background: color-mix(in srgb, var(--cv-accent) 22%, transparent) !important;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cv-accent) 60%, transparent);
    }
    .cube-table td.cell-anchor {
      box-shadow: inset 0 0 0 2px var(--cv-accent);
    }
    /* Edit input fills the cell exactly so double-click edit never widens the
       column nor grows the row: the cell keeps its padding, the input carries no
       padding/border and is exactly one line tall (1.4em = the cell line-height).

       The editor sits ABSOLUTELY positioned in the cell. Reason: the table runs with
       table-layout auto, so the browser measures the column width by its content
       — and a select reports its WIDEST OPTION as its intrinsic minimum
       width. In the flow, the column therefore jumped open on a double-click on a
       picklist cell, even though width 100% is set on it (with auto layout the
       percentage falls back to the intrinsic width). Absolutely positioned,
       the editor no longer counts toward the measurement; the row height is held by the
       other cells of the row. inset = the cell padding, so that the area stays exactly
       the old one. */
    .cube-table td.editing { padding: 2px 10px; position: relative; }
    .cube-table td.editing input, .cube-table td.editing select {
      position: absolute; inset: 0;
      display: block;
      width: auto; height: auto; min-width: 0; min-height: 0; box-sizing: border-box;
      margin: 0; padding: 2px 10px; border: none; outline: none;
      font: inherit; line-height: 1.4; text-align: inherit; vertical-align: top;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground, var(--vscode-foreground));
    }
    /* The native dropdown arrow of the select has to go: the cell carries its
       own (td.cell-picklist::after, 9 px), and .editing keeps the class
       cell-picklist — so there were TWO arrows on top of each other, the native one
       several times larger. Now exactly the same 9 px arrow remains in all three states (idle,
       selected, in the editor). padding-right
       keeps the option text clear of it. */
    .cube-table td.editing select {
      appearance: none; -webkit-appearance: none;
      padding-right: 14px;
    }
    /* Fix round 1 (Minor 1): the picklist round trip (resolvePicklist -> picklistValues)
       has no control to show yet, so .editing alone renders as an inert cell with no
       visible sign the double-click did anything. cursor: wait plus a slight dim is the
       cheapest honest "working on it" -- no extra DOM node, no text-flicker risk. */
    .cube-table td.editing.cell-picklist-pending { cursor: wait; opacity: 0.65; }
    .cube-table th[data-dim-name] { cursor: context-menu; }
    .cell-toggle {
      display: inline-block; width: 12px; text-align: center;
      margin-right: 3px; cursor: pointer; user-select: none;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .cell-toggle:hover { color: var(--vscode-foreground); }

    /* ── Save modal ── */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 100;
      align-items: center; justify-content: center;
    }
    .modal-overlay.visible { display: flex; }
    .modal-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 4px;
      padding: 16px 18px;
      min-width: 340px; max-width: 500px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    }
    .modal-box h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    .mdx-modal-box { min-width: 720px; max-width: 90vw; }
    .mdx-editor-mount {
      width: 100%; height: 360px; max-height: 60vh;
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      overflow: hidden;
    }
    .mdx-modal-box textarea {
      width: 100%; min-height: 280px; max-height: 60vh;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre; overflow: auto;
      resize: vertical;
    }
    .modal-row { margin-bottom: 10px; }
    .modal-row label {
      display: block; font-size: 11px;
      color: var(--vscode-descriptionForeground); margin-bottom: 3px;
    }
    .modal-row input[type=text] {
      width: 100%; padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .modal-row input[type=text]:focus { outline: 1px solid var(--cv-accent); }
    .modal-radios label {
      display: inline-flex; align-items: center; margin-right: 12px;
      cursor: pointer; font-size: 12px; color: var(--vscode-foreground);
    }
    .modal-radios input { margin-right: 4px; }
    .modal-checkbox label {
      display: inline-flex; align-items: center;
      cursor: pointer; font-size: 12px; color: var(--vscode-foreground);
    }
    .modal-checkbox input { margin-right: 4px; }
    .modal-actions {
      display: flex; gap: 6px; justify-content: flex-end; margin-top: 14px;
    }
    .modal-actions button {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--cv-grid-line-strong);
      padding: 4px 12px;
    }
    .modal-actions button:hover {
      background: color-mix(in srgb, var(--cv-accent) 10%, transparent);
      border-color: var(--cv-accent);
    }
    .modal-actions .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      font-weight: 600;
    }
    .modal-actions .primary:hover { background: var(--vscode-button-hoverBackground); }
    .modal-msg { font-size: 11px; margin-top: 8px; min-height: 14px; }
    .modal-msg.error { color: var(--vscode-errorForeground, #f48771); }
    .modal-msg.info { color: var(--vscode-descriptionForeground); }
    .modal-error {
      color: var(--vscode-errorForeground, #f48771);
      font-size: 12px; margin-bottom: 8px;
    }
    /* Format dialog. A [hidden] row must beat the display rules below. */
    .fmt-box [hidden], #view-save-modal [hidden] { display: none !important; }
    .fmt-box { min-width: 420px; }
    .fmt-box select, .fmt-box input[type=number], .fmt-box input[type=text] {
      padding: 3px 6px; font-size: 12px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--cv-grid-line-strong); border-radius: 3px;
    }
    .fmt-grid {
      display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px;
      align-items: center; margin-bottom: 10px; font-size: 12px;
    }
    .fmt-grid input[type=number] { width: 64px; }
    .fmt-grid input[type=checkbox] { justify-self: start; margin: 0; }
    .fmt-grid input[type=text], .fmt-grid select { justify-self: start; min-width: 140px; }
    .fmt-box input:disabled { opacity: 0.5; }
    #fmt-pattern { font-family: var(--vscode-editor-font-family); }
    .fmt-recent { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .fmt-chip {
      font-family: var(--vscode-editor-font-family); font-size: 11px; padding: 1px 6px;
      border: 1px solid var(--cv-grid-line-strong); border-radius: 3px; cursor: pointer;
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    }
    .fmt-preview { border-collapse: collapse; font-size: 12px; margin-bottom: 8px; width: 100%; }
    .fmt-preview th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 2px 8px 2px 0; }
    .fmt-preview td { padding: 2px 8px 2px 0; font-variant-numeric: tabular-nums; }
    .fmt-preview td:last-child { text-align: right; }
    .fmt-preview tr.fmt-edge td { color: var(--vscode-descriptionForeground); }
    .fmt-note { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    .fmt-note.fmt-warn { color: var(--vscode-editorWarning-foreground, #cca700); }
    .modal-box > label {
      display: block; font-size: 11px;
      color: var(--vscode-descriptionForeground); margin-bottom: 3px;
    }
    .modal-box > input[type=text] {
      width: 100%; box-sizing: border-box; padding: 4px 8px; margin-bottom: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--cv-grid-line-strong);
      border-radius: 3px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .modal-box > input[type=text]:focus { outline: 1px solid var(--cv-accent); }

    /* ── Inline cell editor ── */
    .cube-table td.editing { padding: 0 !important; }
    .cube-table td.editing input, .cube-table td.editing select {
      width: 100%; height: 100%; box-sizing: border-box;
      border: 1px solid var(--cv-accent);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      padding: 3px 6px;
      font-family: inherit; font-size: inherit;
      font-variant-numeric: tabular-nums;
      text-align: inherit;
      outline: none;
    }
    .cube-table td.cell-error {
      outline: 2px solid var(--vscode-errorForeground);
      outline-offset: -2px;
    }
    .cube-table td.cell-security { cursor: not-allowed !important; }
    .cube-table td.cell-pending { opacity: 0.55; }
`;
