// src/commands/mdx/mdxRunnerL10n.ts
// Resolved UI strings for the MDX-Runner webview. The body markup
// (`mdxRunnerBody`) and the client (`window.__l10n`) share this single map, so
// each English source string is translated once. Keys are stable JS
// identifiers; the `vscode.l10n.t(...)` argument is the localization key
// (English source = key, per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildMdxRunnerL10n(): L10nMap {
  return {
    // static body
    history: vscode.l10n.t('History'),
    clearAllHistoryTitle: vscode.l10n.t('Clear entire history'),
    clearAll: vscode.l10n.t('Clear all'),
    noHistory: vscode.l10n.t('No history yet'),
    runTitle: vscode.l10n.t('Run MDX (F5 / Ctrl+Enter)'),
    run: vscode.l10n.t('Run (F5)'),
    clearEditorTitle: vscode.l10n.t('Clear editor'),
    clear: vscode.l10n.t('Clear'),
    splitTitle: vscode.l10n.t('Drag to resize the editor'),
    formatTitle: vscode.l10n.t('Format MDX (Shift+Alt+F)'),
    format: vscode.l10n.t('Format'),
    copyTsvTitle: vscode.l10n.t('Copy table as TSV to the clipboard'),
    copyTsv: vscode.l10n.t('Copy (TSV)'),
    insertSnippetTitle: vscode.l10n.t('Insert sample query'),
    insertSnippet: vscode.l10n.t('Insert template…'),
    emptyHint: vscode.l10n.t('No query run yet — enter MDX and press Run (F5 / Ctrl+Enter).'),
    // client runtime
    running: vscode.l10n.t('Running…'),
    errorPrefix: vscode.l10n.t('Error'),
    valueEmpty: vscode.l10n.t('Value: (empty)'),
    // `{0}` = raw value, `{1}` = formatted value (filled client-side)
    valueRawFormatted: vscode.l10n.t('Value: {0} ({1})'),
    // `{0}` = value (filled client-side)
    valueOnly: vscode.l10n.t('Value: {0}'),
    justNow: vscode.l10n.t('just now'),
    // `{0}` = minutes (filled client-side)
    minutesAgo: vscode.l10n.t('{0} min ago'),
    // `{0}` = hours (filled client-side)
    hoursAgo: vscode.l10n.t('{0} h ago'),
    // `{0}` = days (filled client-side)
    daysAgo: vscode.l10n.t('{0} days ago'),
    deleteEntry: vscode.l10n.t('Delete entry'),
    confirmClearHistory: vscode.l10n.t('Clear entire MDX history?'),
    confirmClearHistoryDetail: vscode.l10n.t('All saved queries of this server are removed. This cannot be undone.'),
    cancel: vscode.l10n.t('Cancel'),
    copied: vscode.l10n.t('Copied ✓'),
    // `{0}` = rows, `{1}` = cols, `{2}` = total (filled client-side)
    cellsSummary: vscode.l10n.t('{0} × {1} cells · {2} total'),
    // validation marker messages — `{0}` = element/dim, `{1}` = dim (filled client-side)
    unknownElement: vscode.l10n.t("Element '{0}' does not exist in dimension '{1}'."),
    unknownDimension: vscode.l10n.t("Dimension '{0}' does not exist."),
    dimNotInCube: vscode.l10n.t("Dimension '{0}' is not part of the current cube."),
  };
}
