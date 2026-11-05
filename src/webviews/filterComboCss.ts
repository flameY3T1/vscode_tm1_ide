/**
 * Styles of the filterable dropdown (`webviewClient/_shared/filterCombo.ts`):
 * title elements and the view picker in the Cube Viewer, the subset picker in
 * the Dimension Browser.
 */
export const FILTER_COMBO_CSS = `
    .title-combo { position: relative; display: inline-flex; }
    .title-combo-btn {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: none;
      padding: 2px 18px 2px 6px;
      font-family: var(--vscode-font-family); font-size: 11px;
      max-width: 180px; min-width: 60px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-align: left; cursor: pointer; outline: none;
    }
    /* Chevron drawn like the native select arrow (Hierarchy picker), so a
       combo and a plain select side by side look the same. Mask + currentColor
       follows the theme; data: is allowed by the shell's img-src. */
    .title-combo-btn::after {
      content: '';
      position: absolute; right: 6px; top: 50%;
      width: 8px; height: 5px; margin-top: -2px;
      background-color: currentColor; pointer-events: none;
      -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 5'%3E%3Cpath d='M.6.6 4 4 7.4.6' fill='none' stroke='black' stroke-width='1.3'/%3E%3C/svg%3E") no-repeat center / contain;
    }
    .title-combo-btn:disabled { opacity: 0.6; cursor: default; }
    .title-combo-btn:hover:not(:disabled),
    .title-combo.is-open .title-combo-btn {
      background: color-mix(in srgb, var(--vscode-focusBorder) 8%, var(--vscode-input-background));
    }
    /* Mounted in <body> (see filterCombo.ts) because .title-chip-group clips its
       children — position is set from the button's rect at open time. */
    .title-combo-pop {
      position: fixed; z-index: 2002;
      min-width: 220px; max-width: 340px;
      background: var(--vscode-dropdown-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      padding: 4px;
    }
    .title-combo-filter {
      width: 100%; box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 3px 6px; margin-bottom: 4px;
      font-family: var(--vscode-font-family); font-size: 11px;
      outline: none;
    }
    .title-combo-filter:focus { border-color: var(--vscode-focusBorder); }
    /* position: relative makes the list the offsetParent of its rows, so the
       keyboard scroll-into-view can use item.offsetTop. Without it offsetParent
       is .title-combo-pop and every offsetTop is skewed by the filter box. */
    .title-combo-list { position: relative; max-height: 280px; overflow-y: auto; }
    .title-combo-item {
      padding: 3px 6px; font-size: 11px; cursor: pointer;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .title-combo-item.is-current { font-weight: 600; }
    .title-combo-item.is-active,
    .title-combo-item:hover {
      background: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,0.25));
      color: var(--vscode-list-activeSelectionForeground, inherit);
    }
    .title-combo-empty {
      padding: 4px 6px; font-size: 11px; font-style: italic;
      color: var(--vscode-descriptionForeground);
    }
    /* Footer of a capped element list: "<from>–<to> / <total> · Filter elements…" */
    .title-combo-more {
      position: sticky; bottom: 0;
      padding: 4px 6px; font-size: 10px; font-style: italic;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border-top: 1px solid var(--vscode-panel-border);
    }
    /* Public/private heading of a grouped list (views, subsets). */
    .title-combo-group {
      padding: 4px 6px 2px; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em;
      color: var(--vscode-descriptionForeground);
    }
`;
