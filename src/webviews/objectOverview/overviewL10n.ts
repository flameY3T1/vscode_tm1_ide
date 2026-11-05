import * as vscode from 'vscode';

/** UI strings shared by all overview pages, resolved server-side. */
export function buildOverviewL10n(): Record<string, string> {
  return {
    refresh: vscode.l10n.t('Refresh'),
    filterPlaceholder: vscode.l10n.t('Filter by name…'),
    showControl: vscode.l10n.t('Show control objects'),
    loading: vscode.l10n.t('Loading…'),
    empty: vscode.l10n.t('Nothing to show.'),
    // `{0}` shown / `{1}` total
    countShown: vscode.l10n.t('{0} / {1}'),
    // `{0}` = what the table is filtered to (a tile label and/or a badge)
    filteredBy: vscode.l10n.t('Showing only: {0}'),
    clearFilter: vscode.l10n.t('Clear filter'),
    tileFilterHint: vscode.l10n.t('Click to show only these rows'),
  };
}
