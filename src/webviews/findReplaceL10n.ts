// src/webviews/findReplaceL10n.ts
// Resolved UI strings for the Find/Replace webview. The static body markup
// (`findReplaceWebview.ts#BODY_HTML`) and the client (`window.__l10n`) share
// this single map, so each English source string is translated once. Keys are
// stable JS identifiers; the `vscode.l10n.t(...)` argument is the
// localization key (English source = key, per the Phase 2 convention). DE
// translations live in `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildFindReplaceL10n(): L10nMap {
  return {
    // static body
    searchPlaceholder: vscode.l10n.t('Search…'),
    replacePlaceholder: vscode.l10n.t('Replace…'),
    wholeWord: vscode.l10n.t('Whole word'),
    regex: vscode.l10n.t('Regex'),
    search: vscode.l10n.t('Search'),
    replace: vscode.l10n.t('Replace'),
    processes: vscode.l10n.t('Processes'),
    rules: vscode.l10n.t('Rules'),
    nameFilterLabel: vscode.l10n.t('Limit processes by name:'),
    includeControl: vscode.l10n.t('Include control objects'),
    prefixPlaceholder: vscode.l10n.t('Name prefixes (comma-separated)'),
    containsPlaceholder: vscode.l10n.t('Name contains (comma-separated)'),
    suffixPlaceholder: vscode.l10n.t('Name suffixes (comma-separated)'),
    resultsEmpty: vscode.l10n.t('Enter a search term and click Search to find matches.'),
    // client runtime — `{0}`/`{1}` filled client-side
    matchesSummary: vscode.l10n.t('{0} matches in {1} objects'),
    replacedInObjects: vscode.l10n.t('Replaced in {0} objects.'),
    // `{0}` = failed object, `{1}` = error, `{2}` = applied count, `{3}` = not-attempted count
    replaceFailed: vscode.l10n.t('Failed on {0}: {1} — {2} done, {3} not attempted'),
    couldNotRead: vscode.l10n.t('Could not read: {0}'),
    // `{0}` = count of matches skipped because the source changed since the search
    skippedStale: vscode.l10n.t('{0} match(es) skipped — the source changed since your search; re-run Search.'),
  };
}
