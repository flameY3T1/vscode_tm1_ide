// src/webviews/tiValueNamingL10n.ts
// Resolved UI strings for the TI Value Naming webview. Mirrors the
// tiConsistencyL10n.ts pattern: the static body markup (`tiValueNamingBody.ts`)
// and the client (`window.__l10n`) share this single map. Several keys reuse
// the exact English source strings from `tiConsistencyL10n.ts` (List, Scan,
// Apply all, etc.) so those bundle keys are already translated.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildValueNamingL10n(): L10nMap {
  return {
    intro: vscode.l10n.t('Find string variables that hold the same value under different names, and unify the name to one canonical name.'),
    step1: vscode.l10n.t('Choose processes'),
    step2: vscode.l10n.t('Scan and review'),
    valueLabel: vscode.l10n.t('value'),
    noGroups: vscode.l10n.t('No value/name divergences found. Adjust the selected processes and scan again.'),
    prefixPlaceholder: vscode.l10n.t('Name prefixes (comma-separated)'),
    containsPlaceholder: vscode.l10n.t('Name contains (comma-separated)'),
    suffixPlaceholder: vscode.l10n.t('Name suffixes (comma-separated)'),
    includeControl: vscode.l10n.t('Include control objects'),
    procListEmpty: vscode.l10n.t('List processes above to choose which to scan.'),
    listBtn: vscode.l10n.t('List'),
    scanBtn: vscode.l10n.t('Scan'),
    applyAllBtn: vscode.l10n.t('Apply all'),
    applyAllConfirm: vscode.l10n.t('Apply all {0} findings to the selected processes? This writes to TM1.'),
    allLabel: vscode.l10n.t('(all)'),
    countLabel: vscode.l10n.t('{0} of {1} selected'),
    previewBtn: vscode.l10n.t('Preview'),
    applyBtn: vscode.l10n.t('Apply'),
    unreadableLabel: vscode.l10n.t('Unreadable: {0}'),
    appliedLabel: vscode.l10n.t('Applied: {0}'),
    noneLabel: vscode.l10n.t('(none)'),
    skippedSuffix: vscode.l10n.t('skipped: {0}'),
    failedSuffix: vscode.l10n.t('FAILED {0}: {1}'),
    previewEditsLabel: vscode.l10n.t('Preview -> edits: {0}'),
    invalidTarget: vscode.l10n.t('Invalid target: {0}'),
    dupHint: vscode.l10n.t('This process holds the value under multiple names, so it is skipped — folding them all would merge those variables. Uncheck a name to keep it separate and apply the rest.'),
    tabValueNames: vscode.l10n.t('Value names'),
    tabMultiValue: vscode.l10n.t('Multi-value split'),
    splitBtn: vscode.l10n.t('Split'),
    bindingLiteral: vscode.l10n.t('literal'),
    bindingNumeric: vscode.l10n.t('numeric'),
    bindingParam: vscode.l10n.t('param'),
    bindingDatasource: vscode.l10n.t('datasource'),
    bindingDynamic: vscode.l10n.t('dynamic'),
    refusedMerge: vscode.l10n.t('Ambiguous — the value flows into a branch/loop merge; cannot split safely.'),
    refusedCollision: vscode.l10n.t('Target name is already used in this process.'),
    refusedAmbiguous: vscode.l10n.t('Multiple assignments to this variable on one line — cannot split safely.'),
    defLineLabel: vscode.l10n.t('line {0}'),
    excludeHeading: vscode.l10n.t('Excluded variables'),
    excludePlaceholder: vscode.l10n.t('Name or glob (e.g. sDim, *Dim)'),
    excludeAddBtn: vscode.l10n.t('Add'),
    removeLabel: vscode.l10n.t('Remove'),
  };
}
