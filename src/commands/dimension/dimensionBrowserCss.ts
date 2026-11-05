/**
 * CSS for the TM1 Dimension Browser webview. Loaded inline by the shell in
 * `dimensionBrowserWebview.ts` — separated out so the shell stays slim and
 * the styling can be linted/edited without scrolling past the markup + script.
 */
import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';

export const DIMENSION_BROWSER_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --db-grid-line: var(--vscode-editorGroup-border, rgba(128,128,128,0.18));
      --db-grid-line-strong: var(--vscode-panel-border, rgba(128,128,128,0.45));
      --db-header-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
      --db-header-fg: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));
      --db-zebra: rgba(127,127,127,0.04);
      --db-row-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.10));
      --db-accent: var(--vscode-focusBorder, #007acc);
      --db-indent-guide: rgba(127,127,127,0.18);
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column; height: 100vh; overflow: hidden;
      /* Block the browser's native Ctrl+A whole-page text selection — element
         selection is mark-based (state._markedNames / _markedKeys), copy goes
         through the clipboard API. Without this, Ctrl+A highlights the whole
         webview chrome instead of staying inside the table. */
      user-select: none; -webkit-user-select: none;
    }
    /* Editable fields still need real text selection (MDX box, filter input). */
    input, textarea { user-select: text; -webkit-user-select: text; }

    /* ── Controls bar ──────────────────────────────────────── */
    .controls-bar {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 6px 10px;
      background: var(--db-header-bg);
      border-bottom: 1px solid var(--db-grid-line-strong);
      flex-shrink: 0;
    }
    .controls-bar label {
      font-size: 11px; color: var(--vscode-descriptionForeground);
    }
    .controls-bar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--db-grid-line-strong);
      padding: 3px 6px; border-radius: 3px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
      min-width: 160px; max-width: 300px;
    }
    .controls-bar select:focus { outline: 1px solid var(--db-accent); }
    #subset-select { display: none; }
    ${FILTER_COMBO_CSS}
    .controls-bar .title-combo-btn {
      border: 1px solid var(--db-grid-line-strong); border-radius: 3px;
      padding: 3px 18px 3px 6px; font-size: var(--vscode-font-size);
      min-width: 160px; max-width: 300px;
    }
    .controls-bar button {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--db-grid-line-strong);
      padding: 3px 10px; border-radius: 3px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .controls-bar button:hover {
      background: color-mix(in srgb, var(--db-accent) 10%, transparent);
      border-color: var(--db-accent);
    }
    /* \`flex-wrap\` is NOT cosmetic: the group carries five buttons, and without
       wrapping a narrow panel pushes the rear ones out of the visible
       area — they are there, but unreachable. The bar itself already
       wraps (\`.controls-bar\`), its right-hand group did not. */
    .controls-right { margin-left: auto; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    /* Explorer glyphs inside buttons. Both theme variants ship; the wrong one is
       hidden via the \`vscode-*\` body class VS Code sets at runtime. */
    .wv-icon { width: 14px; height: 14px; flex-shrink: 0; pointer-events: none; }
    .wv-icon.dark-only { display: none; }
    body.vscode-dark .wv-icon.light-only,
    body.vscode-high-contrast:not(.vscode-high-contrast-light) .wv-icon.light-only { display: none; }
    body.vscode-dark .wv-icon.dark-only,
    body.vscode-high-contrast:not(.vscode-high-contrast-light) .wv-icon.dark-only { display: inline-block; }
    .controls-right button { display: inline-flex; align-items: center; gap: 5px; }

    /* ── Search bar ────────────────────────────────────────── */
    .search-bar {
      /* A flex row since the bar carries an Apply button: with
         input { width: 100% } alone the button got pushed onto a row of its
         own (click test 2026-08-23). */
      display: flex; align-items: center; gap: 8px;
      padding: 5px 10px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--db-grid-line);
      flex-shrink: 0;
    }
    .search-bar input {
      flex: 1 1 auto; min-width: 0; padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-editorGroup-border));
      border-radius: 2px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .search-bar input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .search-bar input:focus { outline: 1px solid var(--vscode-focusBorder); }

    /* ── Filter bar (level + attribute + quick toggles) ────── */
    .filter-bar {
      display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
      padding: 5px 10px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border-bottom: 1px solid var(--db-grid-line-strong);
      flex-shrink: 0;
    }
    /* Anchor for .vw-attrcols-menu (see below) -- WITHOUT a positioned
       ancestor the menu renders as an ordinary flex child INLINE in the
       bar instead of as an overlay, and pushes the bar apart
       (fix round 1, finding 1).

       Until 2026-08-25 the anchor sat on .filter-bar, i.e. on the WHOLE
       bar: with left: 0 the menu stuck to the left edge of the bar instead of
       below its button. Since the button stands in the controls bar, the anchor
       is this container -- so the menu now hangs where it belongs.
       Do NOT set it on .dim-table thead th: that already carries position: sticky,
       and a second position on the same selector would silently reset the sticky
       header row. */
    .vw-attrcols-wrap { position: relative; display: inline-flex; align-items: center; }
    /* List state (state._orderIsManual): search, filter, sorting and the
       quick type toggles have no effect there — grey them out and block clicks,
       so that the bar does not pretend to be effective. The way back is deliberately
       only via a drill, a loaded subset or the reset.
       All/Keep only/Delete have stood in a bar of their OWN since 2026-08-01
       (#mark-actions, see below) and are therefore not touched by the greying at all —
       in the list state that is precisely the primary control. The earlier
       :not(#mark-actions) exception on the filter bar children is thus dropped. */
    .quick-toggle {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 3px;
      border: 1px solid var(--db-grid-line-strong); background: transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 11px; cursor: pointer; user-select: none;
    }
    .quick-toggle:hover { color: var(--vscode-foreground); border-color: var(--db-accent); }
    /* Glyph-only buttons: the label lives in title/aria-label, so trim the
       horizontal padding a text pill needed and give the glyph room to read. */
    .filter-bar .icon-only { padding: 3px 5px; gap: 0; }
    .filter-bar .icon-only .wv-icon { width: 16px; height: 16px; }
    .quick-toggle.active {
      background: color-mix(in srgb, var(--db-accent) 18%, transparent);
      color: var(--vscode-foreground); border-color: var(--db-accent);
    }
    .filter-bar label { font-size: 11px; color: var(--vscode-descriptionForeground); }
    /* ONE field look for all three bars — the same lesson as with the
       buttons below, only drawn one round later: the rule hung on
       .filter-bar, and the two select fields in the marking row therefore
       fell back to the bare browser look. A white box, as wrong in light
       themes as in dark ones (click test 2026-08-23).
       option needs the colors explicitly: in Chromium the dropped-down menu does
       NOT inherit them from the select, it draws in system white without them.
       (No backticks in this comment - it sits inside a
       template literal and would end it.) */
    .filter-bar select, .filter-bar input[type="text"],
    .mark-bar select, .search-bar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-editorGroup-border));
      padding: 3px 6px; border-radius: 2px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .filter-bar select option, .mark-bar select option, .search-bar select option {
      background: var(--vscode-dropdown-background, var(--vscode-input-background));
      color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    }
    .filter-bar select:focus, .mark-bar select:focus, .search-bar select:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .mark-bar select { min-width: 110px; }
    .filter-bar select[multiple] { min-width: 90px; min-height: 22px; max-height: 60px; }
    .filter-bar select { min-width: 120px; }
    .filter-bar input[type="text"] { min-width: 140px; }
    /* ── Attribute column checkbox list (Task 6, fix round 1 finding 1) ──
       Same look as #ctx-menu further down (menu background/border
       theme variables, shadow, radius) -- the same statement "this is an
       overlaying menu" should look the same in both places. Unlike
       #ctx-menu (position: fixed, follows the mouse)
       this menu hangs at the LEFT edge of the bar: position: absolute
       with left: 0 against the position: relative ancestor .filter-bar (see above),
       not at the edge of the button -- that would need a measured
       position, and the bar is narrow enough that the menu stands
       below the button either way. */
    .vw-attrcols-menu {
      position: absolute; top: 100%; left: 0; margin-top: 2px; z-index: 10;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorGroup-border));
      border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      min-width: 200px; max-height: 320px; overflow-y: auto; padding: 4px 0;
    }
    /* A dimension can have 109 attributes (click test stress case) --
       max-height + overflow-y above cap the height, here only the row. */
    .vw-attrcol-item {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px; cursor: pointer; white-space: nowrap;
      font-size: var(--vscode-font-size);
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
    }
    .vw-attrcol-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }
    .vw-attrcol-item input[type="checkbox"] { flex-shrink: 0; }
    /* Alias marker, pushed to the right edge of the row. */
    .vw-attrcol-tag {
      margin-left: auto; padding: 0 5px; border-radius: 3px; font-size: 10px;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    }
    /* Separates the two placeholder columns (index/weight) from the real
       attributes below. They stand in the same list, but are something
       else -- see attrColumns.ts#COL_INDEX. */
    .vw-attrcol-sep {
      height: 1px; margin: 4px 0;
      background: var(--vscode-menu-separatorBackground, var(--db-grid-line-strong));
    }
    .vw-attrcol-empty {
      padding: 6px 14px; font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    /* ONE button look for all three bars. Before, it stood there twice
       (.filter-bar and .mark-bar) and not at all for .search-bar — whose
       Apply button therefore fell back to the bare browser look:
       a white box, just as wrong in light themes as in dark ones
       (click test 2026-08-23). One look in one place instead of three copies.
       inline-flex, so that a leading glyph sits next to the label
       instead of above it — the same treatment as .quick-toggle. */
    .filter-bar button, .mark-bar button, .search-bar button {
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none; padding: 3px 10px; border-radius: 2px; cursor: pointer;
      white-space: nowrap;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .filter-bar button:hover, .mark-bar button:hover, .search-bar button:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    /* Keep only/Delete/All: the only visible way back from deletions
       and drills (Spec E7 — no undo). There is no separate "clear markings"
       button: Esc does that (see the keydown handler in dom.ts). */
    /* A bar of its own below the filter bar — the buttons ALWAYS take effect, even
       where the filter bar is greyed out. It shares the button look with the
       two other bars (one rule further up). */
    .mark-bar {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      padding: 5px 10px;
      border-bottom: 1px solid var(--db-grid-line-strong);
    }
    #mark-actions button:disabled { opacity: 0.4; cursor: default; }
    #mark-count { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    /* Minor 7 (final review): #vw-mark-count is the counterpart of the new
       path — a NEW element, no change to #mark-count. */
    #vw-mark-count { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    /* The N/C/S toggles of the marking bar carried the full
       button area of the bar, while their glyph stayed at the default size —
       a lot of frame around little image. The filter bar has long solved this via
       .icon-only; here only the counterpart was missing (click test 2026-08-22). */
    /* Look like the neighboring buttons of the bar (.mark-bar button, see above) —
       only the padding of a text button gives way to the larger glyph. No
       frame of its own: a blue-bordered tile next to flat buttons
       read like a different kind of control (click test 2026-08-22). */
    .mark-bar .icon-only { padding: 2px 6px; gap: 0; }
    .mark-bar .icon-only .wv-icon { width: 20px; height: 20px; }
    /* Pressed: the same accent tint as .quick-toggle.active in the old path,
       but flat instead of bordered. */
    .mark-bar .icon-only.active {
      background: color-mix(in srgb, var(--db-accent) 28%, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
      color: var(--vscode-foreground);
    }
    /* N/C/S carry the LETTER and nothing else (UX decision,
       2026-08-26): no class of their own, no padding of their own, no font of
       their own — so exactly the rule .mark-bar button applies to them as to
       the buttons to their left, and they stand in the same shape and size
       in the row. A cut of their own was exactly what used to stick out of
       line before. */

    /* ── Loading / Error / Placeholder ────────────────────── */
    #loading {
      display: flex; align-items: center; justify-content: center;
      padding: 40px; color: var(--vscode-descriptionForeground);
      flex: 1;
    }
    .spinner {
      width: 18px; height: 18px; margin-right: 10px;
      border: 2px solid var(--vscode-editorGroup-border);
      border-top-color: var(--vscode-progressBar-background, #007acc);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Theme tokens, not a hard-coded salmon tint: pair the error-background with its
       matching validation foreground (falls back to the theme foreground). */
    #error-banner {
      display: none;
      margin: 10px 12px; padding: 10px 12px;
      background: var(--vscode-inputValidation-errorBackground, rgba(229, 20, 0, 0.12));
      border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(229, 20, 0, 0.3));
      border-radius: 3px;
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
      font-size: 12px;
    }

    #placeholder {
      display: none; align-items: center; justify-content: center;
      padding: 40px; color: var(--vscode-descriptionForeground);
      font-style: italic; flex: 1;
    }

    /* ── Pane (single list, Task 6 Pane-Merge) ───────────────── */
    /* One list — replaces the old two-pane grid. Inherits the old .pane's
       flex-column layout — see the Flex-column scroll quirk note below.
       K26 (review 2026-08-02): the initial value is \`display:none\`, NOT \`flex\`. The
       old two-pane markup had a \`display: none\` on the grid, and only
       \`setLoading(false)\` (msg.ts) revealed it — this initial value got lost
       in the merge. With \`flex\` the pane header row
       („Verfügbar 0 / 0") already paints before any message from the host has arrived,
       i.e. a flash above an empty table. This line restores the old
       guarantee: the pane becomes visible exclusively through
       \`setLoading(false)\`, which sets an inline \`display:flex\` and thereby wins. */
    #pane-single { display: none; flex-direction: column; min-height: 0; flex: 1 1 auto; }
    #pane-single > * { flex-shrink: 0; }
    #pane-single #table-container { flex: 1 1 auto; min-height: 0; overflow: auto; }
    /* Only a separator bar now: the label „VERFUEGBAR" (available) said nothing
       that the display below does not show by itself (UX decision,
       2026-08-23). The bar stays because it separates the header and the list.
       min-height instead of padding, so that it does not collapse without text.
       (Backticks in comments of this file must be escaped - it
       sits inside a template literal; hence none here.) */
    .pane-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 10px; min-height: 4px;
      background: var(--db-header-bg);
      border-bottom: 1px solid var(--db-grid-line-strong);
      font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em;
      color: var(--db-header-fg);
      flex-shrink: 0;
    }
    /* The header action bar (with the two sort arrows) stood here until
       the pane merge — markup and buttons are gone, the rule was a corpse.
       This is now guarded by \`dimBrowserCssNoOrphans.test.ts\`. */
    /* Marker of the list state next to the pane title — otherwise there would be
       no hint on screen that the list is currently showing the selection. */
    .pane-mode {
      margin-left: 8px; padding: 0 5px; border-radius: 3px;
      background: color-mix(in srgb, var(--db-accent) 22%, transparent);
      color: var(--db-header-fg); letter-spacing: 0.04em;
    }
    /* MDX marker bar: shows the EFFECTIVE expression (active drill > armed
       subset expression), i.e. exactly what a save would ship. flex-shrink:0 —
       a flex-column child would otherwise be squished to nothing by the
       scrolling #table-container below it. */
    #subset-mdx-bar {
      display: none; align-items: center; gap: 6px;
      flex-shrink: 0;
      padding: 3px 10px;
      border-bottom: 1px solid var(--db-grid-line);
      background: color-mix(in srgb, var(--db-accent) 8%, transparent);
      font-size: 11px;
      cursor: pointer;
      overflow: hidden;
    }
    #subset-mdx-bar:hover { background: color-mix(in srgb, var(--db-accent) 16%, transparent); }
    .subset-mdx-tag {
      flex-shrink: 0;
      text-transform: uppercase; font-weight: 700; font-size: 9px; letter-spacing: 0.08em;
      color: var(--db-accent);
    }
    /* Deviation marker: the effective MDX no longer equals the server stand.
       Deliberately just a badge — the ORIGINAL expression is reachable through
       the bar's tooltip (which then lists original + current), because the bar
       is one flex line already carrying icon + tag + ellipsised MDX; an extra
       "Original" button would eat the width the MDX preview needs, a tooltip
       costs none. */
    .subset-mdx-changed {
      flex-shrink: 0;
      text-transform: uppercase; font-weight: 700; font-size: 9px; letter-spacing: 0.08em;
      color: var(--vscode-editorWarning-foreground, var(--db-accent));
      border: 1px solid currentColor;
      border-radius: 2px;
      padding: 0 3px;
    }
    #subset-mdx-text {
      flex: 1 1 auto; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--vscode-descriptionForeground);
    }

    /* The trail (new loading path, Task 5): the stack of intents from left to
       right. Not a control — only the last link carries an undo. */
    /* \`min-height\`, so that the bar does not jump: a chip carries
       \`padding: 2px 8px\` and is thus 4px taller than bare text (at
       font size 11 even 6px). Without a minimum height the bar grew at the
       moment the first layer was added, and the table below
       slid along — measured 2026-08-24 (Chromium 1228, real webview CSS).
       GROWING ALONG instead of fixed: a fixed number would have jumped again
       with a larger font. Measured over font sizes 11 to 18, each with a
       jump of 0.0px in all states (bare basis, chip, chip with ×,
       typed layer). Incidentally, the × contributes nothing — the 14px sit
       in the chip height. */
    .vw-trail {
      display: flex; align-items: center; gap: 4px; padding: 3px 6px;
      min-height: calc(var(--vscode-font-size) * 1.2 + 11px);
      box-sizing: border-box;
      /* SINGLE-LINE, not wrapping: with \`flex-wrap: wrap\` the bar grew by
         a whole row as soon as the chips no longer fit side by side —
         and the table below slid along. Measured 2026-08-24 at 520px
         panel width: 26.6px up to two chips, 46.0px from three, 68.0px from six.
         How early this strikes depends on the panel width; that is why it sometimes
         looked like a tiny jump and sometimes like none.
         The price is deliberate: many layers now stand behind a
         horizontal scroll instead of below one another. In return, the table
         stays still. */
      flex-wrap: nowrap;
      overflow-x: auto;
      /* Scrollbar HIDDEN, not merely allowed: a visible
         scrollbar is itself 12px high and would push the table down at the moment
         the third chip is added — the same jump as before,
         only once instead of repeatedly (measured 2026-08-24: 26.6px to 39.0px).
         Scrolling still works with the wheel and touchpad. Acceptable because the trail
         is a display and not a control. */
      scrollbar-width: none;
      /* The chips must not shrink, otherwise the scrolling squeezes them
         together instead of scrolling. */
    }
    .vw-trail::-webkit-scrollbar { height: 0; }
    .vw-trail > * { flex-shrink: 0; }
    .vw-trail-base { opacity: .75; }
    /* The trail is a display, not a control — but it stands next to
       buttons and should match them: the same area as .mark-bar button,
       the same rounding. */
    .vw-trail-chip {
      display: inline-flex; align-items: center;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none; border-radius: 2px; padding: 2px 8px;
    }
    /* The typed layer: without fill and with a dashed border, so that it
       looks different from an applied one at first glance. It
       deliberately has no undo x — what has not been created yet cannot have anything
       to undo; clearing the field or Escape removes it.
       Border color from the focus token, because it stays visible in light and dark
       themes alike. */
    .vw-trail-chip.vw-trail-pending {
      background: none;
      color: var(--vscode-descriptionForeground, var(--vscode-foreground));
      border: 1px dashed var(--vscode-focusBorder, var(--vscode-editorGroup-border));
      font-style: italic;
    }
    .vw-trail-sep { opacity: .5; }
    /* The × carried the inherited chip color at the full opacity of its surroundings and
       almost vanished into the background in dark themes. Now it has its own
       foreground color, is larger, and is clearly highlighted on hover (click test
       2026-08-22). */
    .vw-trail-pop {
      background: none; border: none; cursor: pointer;
      padding: 0 0 0 6px; margin-left: 2px;
      color: var(--vscode-foreground); opacity: .8;
      font-size: 14px; line-height: 1;
    }
    .vw-trail-pop:hover { opacity: 1; color: var(--vscode-errorForeground, var(--vscode-foreground)); }

    /* ── Table (Architect-style spreadsheet) ─────────────────── */
    /* overflow-anchor:none — the virtualized body rebuilds innerHTML on every
       redraw; without this the browser's native scroll-anchoring drifts the
       viewport (e.g. root sliding to the middle after "expand fully"). */
    #table-container { flex: 1; overflow: auto; overflow-anchor: none; display: none; background: var(--vscode-editor-background); }

    .dim-table {
      width: 100%; border-collapse: separate; border-spacing: 0;
      font-size: var(--vscode-font-size);
      /* For the \`colgroup\` widths and the ellipsis below. Without this
         the browser negotiates the widths itself and ignores the \`<col>\`. */
      table-layout: fixed;
    }
    .dim-table thead th {
      position: sticky; top: 0; z-index: 5;
      background: var(--db-header-bg);
      color: var(--db-header-fg);
      font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em;
      padding: 6px 10px 7px; text-align: left;
      border-bottom: 2px solid var(--db-grid-line-strong);
      box-shadow: 0 1px 0 var(--db-grid-line);
      white-space: nowrap;
    }
    .dim-table td {
      padding: 1px 10px; vertical-align: middle;
      border-bottom: 1px solid var(--db-grid-line);
      white-space: nowrap;
      line-height: 1.35;
      height: 22px; box-sizing: border-box; overflow: hidden;
    }
    /* Fixed row height — the placeholder geometry of the virtualizer
       (\`viewViewport.ts#drawWindow\`) relies on it. CAUTION: this is a
       MINIMUM, not a cap; from font size 15 on the content pushes beyond it,
       and the renderer therefore MEASURES instead of calculating. */
    .dim-table tbody tr { height: 22px; }
    /* Spacer rows carry no zebra/hover; collapse them visually. */
    .dim-table tbody tr.vspacer td { background: transparent; border: 0; padding: 0; }
    .dim-table tbody tr.vspacer:hover td { background: transparent; box-shadow: none; }
    /* Zebra by visible position (set in \`viewViewport.ts#drawWindow\`) — nth-child breaks under
       virtualization because spacer rows shift parity. */
    .dim-table tbody tr:hover td { background: var(--db-row-hover); }
    /* The only column since the checkbox column was dropped (Task 5) — takes the full
       table width, min-width stays as a lower bound for a very narrow webview. */
    /* A separate type column last existed in the two-column table; since then the type
       sits as \`.type-badge\` INSIDE the name cell — rule removed. */

    /* Consolidations: bold name only (no row tint). */

    /* The checkbox selection class of the two-pane era is gone; since the
       Architect rework \`.row-marked\` (from \`rowIsMarked\`) marks the rows —
       the old class was no longer set by any client module. */
    .row-marked td { background: color-mix(in srgb, var(--db-accent) 28%, transparent) !important; }

    /* clickable rows: click toggles the checkbox mark */

    /* Same specificity as the rule above (2 classes/attributes each) — must
       therefore stand AFTER it, otherwise "pointer" wins by source order and
       draggable rows never show the grab cursor. */
    .dim-table tbody tr[draggable=true] { cursor: grab; }
    .dim-table tbody tr[draggable=true]:active { cursor: grabbing; }

    /* ── Tree toggle + indent guides (PAfE-Style) ──────────── */
    /* Indent spacer — pure padding, no visual guide line. */
    /* PAfE style: element name + type icon close together */

    /* ── Element type icons (PAfE/Perspectives style) ─────────
       N = Numeric (leaf)        -> green filled circle
       C = Consolidated (folder) -> magenta box-plus
       S = String                -> blue quote symbol
       Icons via ::before — the type-badge span has NO textual content
       any more, the letter in the DOM is there via aria-label for screen reading. */
    /* Only N and S: for \`Type === 'C'\` render.ts DELIBERATELY emits no badge — the
       twisty ▶/▼ already signals the consolidation. A \`.type-C\` block stood
       here until 2026-08-02 and was therefore unreachable (S1-9).
       Colors via the theme's chart tokens, so that they do not lose contrast in the
       light theme: \`charts-*\` is the only \`--vscode-*\` group intended as a
       freely selectable CATEGORY palette — which is exactly what N/S are — and it keeps
       the hue across both themes. \`debugTokenExpression-*\` would also be semantically
       close, but flips S from blue to orange via \`-string\`. Hex stays as the fallback for
       themes without chart tokens. */
    .type-N { color: var(--vscode-charts-green, #b5cea8); }
    .type-N::before { content: '\\25CF'; font-size: 9px; }  /* ● filled circle */
    .type-S { color: var(--vscode-charts-blue, #9cdcfe); }
    .type-S::before { content: '\\201C'; font-size: 14px; transform: translateY(-1px); } /* " left-quote */

    /* ── Status footer (always visible) ──────────────────── */
    #status-footer {
      display: flex; align-items: center; gap: 14px;
      padding: 4px 12px; flex-shrink: 0;
      background: var(--db-header-bg);
      border-top: 1px solid var(--db-grid-line-strong);
      font-size: 11px; color: var(--vscode-descriptionForeground);
      font-variant-numeric: tabular-nums;
    }
    #status-footer .stat { display: inline-flex; align-items: center; gap: 4px; }
    #status-footer .stat strong { color: var(--vscode-foreground); font-weight: 600; }
    #status-footer .sep { width: 1px; height: 12px; background: var(--db-grid-line); }

    /* ── Selection footer (selection mode only) ────────────── */
    #selection-footer {
      display: none; flex-shrink: 0;
      align-items: center; gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-editorGroup-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    #sel-count {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      min-width: 80px;
    }
    /* Until 2026-08-02 the flex alignment stood a second time further up at
       \`.controls-right button\` — two blocks for the same selector that drift
       apart at the next rework. This is the only one. */
    #selection-footer button {
      display: inline-flex; align-items: center; gap: 5px;
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    #selection-footer button:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }
    #btn-confirm {
      margin-left: auto;
      background: var(--vscode-button-background) !important;
      color: var(--vscode-button-foreground) !important;
      padding: 4px 16px !important; font-weight: 600;
    }
    #btn-confirm:hover { background: var(--vscode-button-hoverBackground) !important; }
    #btn-confirm:disabled { opacity: 0.4; cursor: default; }

    /* ── Save modal ──────────────────────────────────────── */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 100;
      align-items: center; justify-content: center;
    }
    .modal-overlay.visible { display: flex; }
    .modal-box {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorGroup-border);
      border-radius: 4px;
      padding: 16px 18px;
      min-width: 340px; max-width: 500px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    }
    .modal-box h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    .mdx-modal-box { min-width: 720px; max-width: 90vw; }
    .mdx-editor-mount {
      width: 100%; height: 360px; max-height: 60vh;
      border: 1px solid var(--db-grid-line-strong, var(--vscode-editorGroup-border));
      border-radius: 3px;
      overflow: hidden;
    }
    .mdx-modal-box textarea {
      width: 100%; min-height: 280px; max-height: 60vh;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--db-grid-line-strong);
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre; overflow: auto;
      resize: vertical;
    }
    .modal-row { margin-bottom: 10px; }
    .modal-row label { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 3px; }
    .modal-row input[type=text] {
      width: 100%; padding: 4px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-editorGroup-border));
      border-radius: 2px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .modal-row input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); }
    .modal-radios label { display: inline-flex; align-items: center; margin-right: 12px; cursor: pointer; font-size: 12px; color: var(--vscode-foreground); }
    .modal-radios input { margin-right: 4px; }
    .modal-checkbox label { display: inline-flex; align-items: center; cursor: pointer; font-size: 12px; color: var(--vscode-foreground); }
    .modal-checkbox input { margin-right: 4px; }
    .modal-checkbox input:disabled { cursor: default; }
    /* Reason line under a disabled checkbox, plus a preview of the MDX that
       would be stored. Both are toggled from the client (display none/block). */
    .modal-hint { display: none; font-size: 11px; color: var(--vscode-descriptionForeground); margin: 2px 0 0 18px; }
    .modal-mdx-preview { display: none; margin: 4px 0 0 18px; }
    .modal-mdx-preview code {
      font-family: var(--vscode-editor-font-family, monospace); font-size: 11px;
      color: var(--vscode-descriptionForeground); word-break: break-all;
    }
    .modal-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 14px; }
    .modal-actions button {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .modal-actions button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .modal-actions .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
    }
    .modal-actions .primary:hover { background: var(--vscode-button-hoverBackground); }
    .modal-msg { font-size: 11px; margin-top: 8px; min-height: 14px; }
    .modal-msg.error { color: var(--vscode-errorForeground, #f48771); }
    .modal-msg.info { color: var(--vscode-descriptionForeground); }

    /* ── Context menu ────────────────────────────────────── */
    #ctx-menu {
      display: none; position: fixed; z-index: 2000;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorGroup-border));
      border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      min-width: 190px; padding: 4px 0;
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
    .ctx-item.ctx-has-submenu { position: relative; padding-right: 22px; }
    .ctx-submenu-arrow { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.7; display: none; }
    .ctx-item.ctx-has-submenu.ctx-multi .ctx-submenu-arrow { display: inline; }
    .ctx-submenu {
      display: none; position: absolute; left: 100%; top: -5px;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-editorGroup-border));
      border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      min-width: 180px; max-height: 320px; overflow-y: auto; padding: 4px 0; z-index: 2001;
    }
    .ctx-item.ctx-has-submenu.ctx-multi:hover > .ctx-submenu,
    .ctx-item.ctx-has-submenu.ctx-multi.ctx-submenu-open > .ctx-submenu { display: block; }
    .ctx-submenu-item.active { font-weight: 600; }
    .ctx-submenu-item.active::before { content: '\\2713\\00a0'; }
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
    .ctx-sep { height: 1px; background: var(--vscode-menu-separatorBackground, var(--vscode-editorGroup-border)); margin: 4px 0; }
    /* Vertically 1px, not 2px: \`height: 22px\` on \`.dim-table tbody tr\` is a
       MINIMUM, not a cap. With the VS Code default font of 13px,
       \`13 × 1.35 + 2×2 + 1\` = 22.547px — the row grows beyond the fixed
       height, and the virtualizer (\`viewViewport.ts#drawWindow\`)
       computes placeholders from a number that is then no longer right. With 1px
       it is 22.000px, up to font size 14 and across all display
       scalings (measured 2026-08-24). Horizontally 10px, so that the cell sits as
       in the old path. */
    .vw-row td { padding: 1px 10px; white-space: nowrap; }
    /* Ellipsis ONLY on the ATTRIBUTE cells (fix round 2, finding 4).
       Before, it was on every cell -- i.e. also for everyone who never turns on an
       attribute column. Under \`table-layout: fixed\` that cut off long,
       deeply indented element names, and with no way out: until then the
       table grew beyond 100 % under \`auto\` layout and
       \`#table-container { overflow: auto }\` let it be read horizontally.
       The ROW HEIGHT is held by \`white-space: nowrap\` (above, for every cell) --
       not by \`overflow: hidden\`. Wrapping would make rows different heights
       and invalidate the placeholder arithmetic of the virtualizer. */
    .vw-row td.vw-attr {
      overflow: hidden; text-overflow: ellipsis;
      color: var(--vscode-descriptionForeground);
    }
    /* Index and weight are numbers -- right-aligned and in digits of equal
       width, so that the column reads as a number column and not
       as text that happens to consist of digits. */
    .vw-row td.vw-attr.vw-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum";
    }
    /* The name cell may run beyond its column; the container then scrolls
       horizontally as before. \`visible\` has to be stated explicitly, because
       \`.dim-table td\` further up sets \`overflow: hidden\`. So that the column is not
       squeezed down to zero with many attribute columns, the
       table renderer sets a minimum width (\`viewRender.ts#tableMinWidth\`). */
    .vw-row td:first-child { overflow: visible; }
    /* Grip area for dragging the column width. \`.dim-table thead th\` already
       carries \`position: sticky\` — that is NOT \`static\` and thus already the
       positioning base for the absolutely positioned grip; a second
       \`position\` on the same selector would let the cascade decide by source order
       and silently switch off the sticky header row. */
    /* The handle sits on the LEFT of the column, not the right (UX decision,
       2026-08-26). Whoever wants to drag an attribute column wider grabs the
       separator line BEFORE its name — the right-hand line read as the one of the
       NEXT column. The sign goes with it: dragging to the LEFT makes it
       wider (\`colResize.ts#computeWidth\`) — the gesture is "pulling
       outward". The grabbed line does not move along, the column always
       grows to the right under \`table-layout: fixed\`. */
    .vw-col-grip {
      position: absolute; top: 0; left: 0; width: 5px; height: 100%;
      cursor: col-resize; user-select: none;
    }
    .vw-col-grip:hover { background: var(--db-grid-line-strong); }
    /* Consolidations bold — the same weight as in the Cube Viewer
       (\`.cube-table td.cell-consolidated\`, 600), so that the same statement looks
       the same in both views. Measured 2026-08-24: bold does not change the
       row height, the virtualizer keeps computing with 22px. */
    .vw-row.vw-c td { font-weight: 600; }
    /* The same look as the collapse triangle in the Cube Viewer (.cell-toggle):
       the same CHARACTERS and the same size. Before, the large
       shapes (U+25B6/U+25BC) stood here in the inherited font size, over there the small ones
       (U+25B8/U+25BE) at 10px — the same thing looked clearly
       different in two places (click test 2026-08-23). */
    /* The insertion line while dragging — the same language as the old path
       had (removed 2026-10-04): a 2px inner edge on the
       td instead of a border, so that the row height does not change and
       nothing jumps. --db-accent hangs off --vscode-focusBorder and thus
       works in EVERY theme, light and dark. */
    .vw-row.vw-drop-above td { box-shadow: inset 0 2px 0 var(--db-accent); }
    .vw-row.vw-drop-below td { box-shadow: inset 0 -2px 0 var(--db-accent); }
    .vw-twisty {
      display: inline-block; width: 12px; text-align: center;
      cursor: pointer; user-select: none;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .vw-twisty:hover { color: var(--vscode-foreground); }
    .vw-twisty::before { content: '▸'; }
    .vw-twisty.vw-open::before { content: '▾'; }
    .vw-nokid { display: inline-block; width: 12px; }
`;
