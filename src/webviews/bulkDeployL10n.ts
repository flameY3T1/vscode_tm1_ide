// src/webviews/bulkDeployL10n.ts
// Resolved UI texts of the bulk migration. Same pattern as
// `bulkDeleteL10n.ts`: the body (`bulkDeployWebview.ts`) and the client
// (`window.__l10n`) share this one map. Translations in
// `l10n/bundle.l10n.<language>.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import { buildBulkTableL10n } from './bulkTableL10n';

export function buildBulkDeployL10n(): L10nMap {
  return {
    // What both bulk pages name the same — kinds, pattern field,
    // selection buttons, counters. Their own entries override them below.
    ...buildBulkTableL10n(),
    hint: vscode.l10n.t('Pick object types, filter by name, then search. Checking what the objects need on the target server is a second, separate step. Names are kept as they are; private views and subsets are not listed.'),
    step2: vscode.l10n.t('Select objects, check what they need on the target server and compare their content'),
    step3: vscode.l10n.t('Deploy'),
    target: vscode.l10n.t('Target'),
    targetNone: vscode.l10n.t('No other connected server'),
    refreshTargets: vscode.l10n.t('Reload the list of connected servers'),
    checkBtn: vscode.l10n.t('Check and compare'),
    pickTarget: vscode.l10n.t('Pick a target server first.'),
    pickRows: vscode.l10n.t('Select the objects you want to check or deploy.'),
    deployBtn: vscode.l10n.t('Deploy selected'),
    colTarget: vscode.l10n.t('On target'),
    colMissing: vscode.l10n.t('Missing there'),
    checking: vscode.l10n.t('Checking against the target server…'),
    deploying: vscode.l10n.t('Deploying…'),
    // Object kinds, singular for the type column.
    kindRule: vscode.l10n.t('Rules'),
    kindHierarchy: vscode.l10n.t('Hierarchy'),
    // Object kinds, plural for the type selection.
    kindRules: vscode.l10n.t('Rules'),
    // Target column: answers ONE question — is something new created, or is
    // something lost over there?
    targetIdle: vscode.l10n.t('not checked'),
    targetNew: vscode.l10n.t('new'),
    targetOverwrite: vscode.l10n.t('overwrites'),
    colContent: vscode.l10n.t('Content'),
    diffOnly: vscode.l10n.t('Only differences'),
    contentSame: vscode.l10n.t('same'),
    contentError: vscode.l10n.t('not readable'),
    contentOpenDiff: vscode.l10n.t('Open the comparison side by side'),
    contentExpected: vscode.l10n.t('Also differs, as expected between servers: {0}'),
    missingNone: vscode.l10n.t('complete'),
    missingCount: vscode.l10n.t('{0} missing'),
    missingUnknown: vscode.l10n.t('unknown'),
    detailMissing: vscode.l10n.t('Missing'),
    unresolvedWarning: vscode.l10n.t('Some references could not be resolved statically (data source or object name comes from a variable). "complete" may be wrong for those rows.'),
    inSelectionNote: vscode.l10n.t('Objects that are part of this selection are not counted as missing — they are written first (processes, then rules, subsets, views, chores).'),
    incompleteWarning: vscode.l10n.t('The reference index is incomplete ({0} could not be read). "complete" may be wrong here.'),
    inventoryWarning: vscode.l10n.t('The target server inventory is incomplete ({0} could not be read).'),
  };
}
