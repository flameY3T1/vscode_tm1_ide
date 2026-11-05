// src/webviews/tiConsoleL10n.ts
// Resolved UI texts of the TI console. Same pattern as
// `tiConsistencyL10n.ts`: the body (`tiConsoleWebview.ts`) and the client
// (`window.__l10n`) share this one map, so that every English
// source text is translated exactly once. Translations in
// `l10n/bundle.l10n.<sprache>.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildTiConsoleL10n(): L10nMap {
  return {
    hint: vscode.l10n.t('Runs a TurboIntegrator snippet without leaving a process on the server. Press Ctrl+Enter or F5 to run.'),
    run: vscode.l10n.t('Run'),
    running: vscode.l10n.t('Running…'),
    empty: vscode.l10n.t('Nothing to run.'),
    ok: vscode.l10n.t('Completed successfully.'),
    failedStatus: vscode.l10n.t('TM1 reported: {0}'),
    cancelled: vscode.l10n.t('Cancelled.'),
    elapsed: vscode.l10n.t('{0} ms'),

    // --- Verlauf ---
    history: vscode.l10n.t('History'),
    noHistory: vscode.l10n.t('No snippets run yet.'),
    clearAll: vscode.l10n.t('Clear'),
    clearAllTitle: vscode.l10n.t('Remove every entry from the history'),
    clearEditor: vscode.l10n.t('Clear editor'),
    clearEditorTitle: vscode.l10n.t('Empty the editor'),
    rerunTitle: vscode.l10n.t('Run this snippet again'),
    deleteEntryTitle: vscode.l10n.t('Remove this entry'),
    // `{0}` = minutes
    minutesAgo: vscode.l10n.t('{0} min ago'),
    // `{0}` = hours
    hoursAgo: vscode.l10n.t('{0} h ago'),
    // `{0}` = days
    daysAgo: vscode.l10n.t('{0} d ago'),
    justNow: vscode.l10n.t('just now'),

    // --- signature hover doc (tiSignatureRender.buildMarkdownDoc) ---
    // Verbatim identical to `processEditorL10n.ts`: the same explanation map, the same
    // keys — `markdownDocLabelsFromL10n` reads them from this map.
    sigParameters: vscode.l10n.t('**Parameters:**'),
    // `{0}` = return type
    sigReturns: vscode.l10n.t('**Returns:** *{0}*'),
    // `{0}` = minimum argument count
    sigVariadic: vscode.l10n.t('*Variadic: at least {0} arguments.*'),
    sigDeprecatedV12: vscode.l10n.t('⚠️ **Not available in TM1 v12 (Planning Analytics Cloud Native).**'),
    // `{0}` = recommended section, `{1}` = reason
    sigPerformance: vscode.l10n.t('💡 **Performance:** Ideal in the `{0}` section ({1}).'),
  };
}
