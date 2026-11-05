// src/webviews/bulkTableL10n.ts
//
// The UI texts that bulk delete and bulk migration share:
// object kinds, pattern field, selection buttons, counters, loading state.
//
// Until 2026-09-20 they were spelled out in both builders — 28 of 50
// or 56 entries verbatim. A change to a kind name thereby hit
// only one of the two pages, and no gate sees such a thing: key and value
// would be valid on both sides, just different.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildBulkTableL10n(): L10nMap {
  return {
    colName: vscode.l10n.t('Name'),
    colType: vscode.l10n.t('Type'),
    counts: vscode.l10n.t('{0} shown, {1} selected'),
    expandTitle: vscode.l10n.t('Show the names'),
    kindChore: vscode.l10n.t('Chore'),
    kindChores: vscode.l10n.t('Chores'),
    // Object kinds, singular for the type column.
    kindCube: vscode.l10n.t('Cube'),
    kindDimension: vscode.l10n.t('Dimension'),
    kindFailed: vscode.l10n.t('Could not list: {0}'),
    kindProcess: vscode.l10n.t('Process'),
    kindProcesses: vscode.l10n.t('Processes'),
    kindSubset: vscode.l10n.t('Subset'),
    kindSubsets: vscode.l10n.t('Subsets'),
    kindView: vscode.l10n.t('View'),
    kindViews: vscode.l10n.t('Views'),
    loading: vscode.l10n.t('Loading objects…'),
    noRows: vscode.l10n.t('Nothing matches this pattern.'),
    pattern: vscode.l10n.t('Pattern'),
    patternHelp: vscode.l10n.t('With * or ? the pattern must match the whole name; without them a match anywhere is enough. Case is ignored.'),
    patternPlaceholder: vscode.l10n.t('e.g. zzTest_*  — empty matches everything'),
    pickTypes: vscode.l10n.t('Pick at least one type, then search.'),
    searchBtn: vscode.l10n.t('Search'),
    selectAll: vscode.l10n.t('Select all shown'),
    selectNone: vscode.l10n.t('Clear selection'),
    showControl: vscode.l10n.t('Include control objects (})'),
    step1: vscode.l10n.t('Find objects'),
    types: vscode.l10n.t('Types'),
    usageMore: vscode.l10n.t('+{0} more'),
  };
}
