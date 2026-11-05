// src/webviews/bulkDeleteL10n.ts
// Resolved UI texts of the bulk delete. Same pattern as
// `tiConsoleL10n.ts`: the body (`bulkDeleteWebview.ts`) and the client
// (`window.__l10n`) share this one map. Translations in
// `l10n/bundle.l10n.<language>.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import { buildBulkTableL10n } from './bulkTableL10n';

export function buildBulkDeleteL10n(): L10nMap {
  return {
    // What both bulk pages name the same — kinds, pattern field,
    // selection buttons, counters. Their own entries override them below.
    ...buildBulkTableL10n(),
    hint: vscode.l10n.t('Pick object types, filter by name, then search. Checking what depends on the selected objects is a second, separate step. Private views and subsets are not listed.'),
    step2: vscode.l10n.t('Select objects and check what depends on them'),
    step3: vscode.l10n.t('Delete'),
    usageBtn: vscode.l10n.t('Check dependencies'),
    pickRows: vscode.l10n.t('Select the objects you want to check or delete.'),
    deleteBtn: vscode.l10n.t('Delete selected'),
    colStatus: vscode.l10n.t('Status'),
    colRules: vscode.l10n.t('Rules'),
    analyzing: vscode.l10n.t('Analyzing references…'),
    deleting: vscode.l10n.t('Deleting…'),
    // Object kinds, singular for the type column.
    // Object kinds, plural for the type selection.
    kindCubes: vscode.l10n.t('Cubes'),
    kindDimensions: vscode.l10n.t('Dimensions'),
    // Dependency column.
    usageIdle: vscode.l10n.t('not checked'),
    usagePending: vscode.l10n.t('checking…'),
    usageUnknown: vscode.l10n.t('unknown'),
    // The status column answers ONE question: can this be deleted? What
    // merely breaks is shown next to it as a number — that is not a block.
    statusFree: vscode.l10n.t('free'),
    statusHeld: vscode.l10n.t('held: {0}'),
    detailHeld: vscode.l10n.t('Held by'),
    usageOpen: vscode.l10n.t('show all'),
    usageOpenTitle: vscode.l10n.t('Open the usage view for this object'),
    dynamicDataSourceWarning: vscode.l10n.t('These processes set their data source from a variable, so it cannot be resolved here: {0}'),
    incompleteWarning: vscode.l10n.t('The reference index is incomplete ({0} could not be read). "none" may be wrong here.'),
  };
}
