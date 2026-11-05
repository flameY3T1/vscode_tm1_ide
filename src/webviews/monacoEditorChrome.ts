import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

/**
 * Shell pieces the Monaco editor family (process and rule editor) shares:
 * bundle URIs, the "Code actions" edit menu, and the CSS blocks for the
 * find bar and the references tab. Each piece is
 * interpolated at the place the editor had it before, so the cascade order
 * stays the same.
 */

export interface MonacoEditorUris {
  scriptUri: vscode.Uri;
  monacoVendorUri: vscode.Uri;
  styleUri: vscode.Uri;
  iconUri: (theme: 'light' | 'dark', name: string) => string;
}

/** `entry` is the client bundle in out/webview, e.g. 'ruleEditorMonaco.js'. */
export function monacoEditorUris(webview: vscode.Webview, extensionUri: vscode.Uri, entry: string): MonacoEditorUris {
  const out = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', file));
  return {
    scriptUri: out(entry),
    monacoVendorUri: out('monaco-vendor.js'),
    styleUri: out('monaco-vendor.css'),
    iconUri: (theme, name) =>
      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'icons', theme, `${name}.svg`)).toString(),
  };
}

/** Icons of the edit-menu button and its rows; spread into the editor's icon map. */
export function editMenuIcons(iconUri: MonacoEditorUris['iconUri']): Record<string, string> {
  return {
    editStackLight: iconUri('light', 'format-conditions-stack'),
    editStackDark:  iconUri('dark',  'format-conditions-stack'),
    indentLight:    iconUri('light', 'indent'),
    indentDark:     iconUri('dark',  'indent'),
    outdentLight:   iconUri('light', 'outdent'),
    outdentDark:    iconUri('dark',  'outdent'),
    commentLight:   iconUri('light', 'comment'),
    commentDark:    iconUri('dark',  'comment'),
    uncommentLight: iconUri('light', 'uncomment'),
    uncommentDark:  iconUri('dark',  'uncomment'),
  };
}

/** The edit-menu popup rows; wired by webviewClient/_shared/editMenu.ts. */
export const editMenuHtml = (icons: Record<string, string>, t: L10nMap) => `<div id="edit-menu" class="format-menu" hidden>
      <button type="button" class="act" data-action="editor.action.indentLines"><img class="btn-icon light-only" src="${icons.indentLight}" alt=""><img class="btn-icon dark-only" src="${icons.indentDark}" alt=""><span class="lbl">${t.edIndent}</span><span class="kbd">Tab</span></button>
      <button type="button" class="act" data-action="editor.action.outdentLines"><img class="btn-icon light-only" src="${icons.outdentLight}" alt=""><img class="btn-icon dark-only" src="${icons.outdentDark}" alt=""><span class="lbl">${t.edOutdent}</span><span class="kbd">Shift+Tab</span></button>
      <button type="button" class="act" data-action="editor.action.addCommentLine"><img class="btn-icon light-only" src="${icons.commentLight}" alt=""><img class="btn-icon dark-only" src="${icons.commentDark}" alt=""><span class="lbl">${t.edComment}</span><span class="kbd">Ctrl+#</span></button>
      <button type="button" class="act" data-action="editor.action.removeCommentLine"><img class="btn-icon light-only" src="${icons.uncommentLight}" alt=""><img class="btn-icon dark-only" src="${icons.uncommentDark}" alt=""><span class="lbl">${t.edUncomment}</span><span class="kbd">Ctrl+#</span></button>
    </div>`;

/** Find & Replace bar markup; wired by webviewClient/_shared/findOverlay.ts. */
export const xfindHtml = (t: L10nMap) => `<div id="xfind" role="search" aria-label="${t.xfindAria}">
        <div class="xfind-row">
          <button id="xfind-toggle" class="xfind-expand" title="${t.xfindToggleTitle}">▸</button>
          <input id="xfind-input" type="text" placeholder="${t.xfindPlaceholder}" autocomplete="off" spellcheck="false" />
          <span class="xfind-count" id="xfind-count">0 / 0</span>
          <button id="xfind-prev" title="${t.xfindPrevTitle}">◀</button>
          <button id="xfind-next" title="${t.xfindNextTitle}">▶</button>
          <button id="xfind-case" title="${t.xfindCaseTitle}">Aa</button>
          <button id="xfind-close" title="${t.xfindCloseTitle}">✕</button>
        </div>
        <div class="xfind-row xfind-replace-row">
          <span style="width: 24px;"></span>
          <input id="xfind-replace" type="text" placeholder="${t.xfindReplacePlaceholder}" autocomplete="off" spellcheck="false" />
          <button id="xfind-replace-one" title="${t.xfindReplaceOneTitle}">↪</button>
          <button id="xfind-replace-all" title="${t.xfindReplaceAllTitle}">↪↪</button>
        </div>
        <div id="xfind-results" role="listbox"></div>
      </div>`;

/*
 * Find & Replace bar of webviewClient/_shared/findOverlay. The section badge
 * (.xfr-badge) is only rendered when the overlay spans several models
 * (process editor), so the rule editor never shows it.
 */
export const MONACO_XFIND_CSS = `
  #xfind { position: absolute; top: 6px; right: 20px; z-index: 10; display: none;
    background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-contrastBorder, var(--vscode-editorWidget-border));
    border-radius: 3px; padding: 4px 6px; font-size: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2); flex-direction: column; gap: 4px; }
  #xfind.visible { display: flex; }
  #xfind .xfind-row { display: flex; gap: 4px; align-items: center; }
  #xfind.replace-mode .xfind-replace-row { display: flex; }
  #xfind .xfind-replace-row { display: none; }
  #xfind input { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px;
    width: 220px; border-radius: 2px; outline: none; }
  #xfind input:focus { border-color: var(--vscode-focusBorder); }
  #xfind .xfind-count { color: var(--vscode-descriptionForeground); min-width: 110px; text-align: center; font-variant-numeric: tabular-nums; }
  #xfind button { background: transparent; color: var(--vscode-foreground); border: none; cursor: pointer;
    padding: 3px 6px; font-size: 12px; border-radius: 2px; min-width: 24px; }
  #xfind button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
  #xfind button:disabled { opacity: 0.4; cursor: default; }
  #xfind button.toggled { background: var(--vscode-inputOption-activeBackground); color: var(--vscode-inputOption-activeForeground); }
  #xfind .xfind-expand { font-size: 10px; opacity: 0.7; padding: 3px 4px; }
  #xfind .xfind-expand:hover { opacity: 1; }
  #xfind-results { display: none; max-height: 240px; min-width: 380px; overflow-y: auto; margin-top: 2px;
    border-top: 1px solid var(--vscode-editorWidget-border, transparent); }
  #xfind-results.has-results { display: block; }
  #xfind .xfr-row { display: flex; align-items: baseline; gap: 6px; padding: 2px 4px; cursor: pointer;
    white-space: nowrap; border-radius: 2px; }
  #xfind .xfr-row:hover { background: var(--vscode-list-hoverBackground); }
  #xfind .xfr-row.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  #xfind .xfr-badge { flex: 0 0 auto; min-width: 58px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.04em; opacity: 0.8; }
  #xfind .xfr-ln { flex: 0 0 auto; min-width: 30px; text-align: right; color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums; }
  #xfind .xfr-row.active .xfr-badge, #xfind .xfr-row.active .xfr-ln { color: inherit; opacity: 1; }
  #xfind .xfr-snip { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family, monospace); }
  #xfind .xfr-match { font-weight: 700; color: var(--vscode-editor-findMatchHighlightForeground, inherit); }
`;

/*
 * References tab (webviewClient/_shared/monacoReferences.ts). .hl-ref-active
 * is the inline decoration on every occurrence; Monarch token colors win by
 * specificity, hence !important.
 */
export const MONACO_REFERENCES_CSS = `
  .ref-toolbar { display: flex; gap: 8px; align-items: center; padding: 0 0 8px 0; font-size: 12px; }
  .ref-toolbar input[type="text"] { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; }
  .ref-toolbar input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .ref-toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; font-size: 11px; cursor: pointer; border-radius: 2px; }
  .ref-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  #ref-word-info { color: var(--vscode-descriptionForeground); }
  #ref-info { color: var(--vscode-descriptionForeground); font-size: 11px; padding: 0 0 8px 0; }
  .ref-table .rft-ctx { font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; }
  .ref-table mark { background: var(--vscode-editor-findMatchHighlightBackground); color: inherit; padding: 0 1px; }
  .hl-ref-active { background: var(--vscode-editor-findMatchHighlightBackground) !important; outline: 1px solid var(--vscode-editor-findMatchBorder, transparent); border-radius: 2px; }
`;
