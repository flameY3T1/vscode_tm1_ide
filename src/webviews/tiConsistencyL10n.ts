// src/webviews/tiConsistencyL10n.ts
// Resolved UI strings for the TI Consistency Normalizer webview. Mirrors the
// findReplaceL10n.ts pattern: the static body markup (`tiConsistencyBody.ts`)
// and the client (`window.__l10n`) share this single map, so each English
// source string is translated once. Keys are stable JS identifiers; the
// `vscode.l10n.t(...)` argument is the localization key (English source = key,
// per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildConsistencyL10n(): L10nMap {
  return {
    // static body — intro + guided step headings
    intro: vscode.l10n.t('Find identifiers, functions, or keywords that are spelled inconsistently across the selected processes, then unify them in one place.'),
    step1: vscode.l10n.t('Choose what to unify'),
    step2: vscode.l10n.t('Choose processes'),
    step3: vscode.l10n.t('Scan and review'),
    // static body — per-rule descriptions (shown under the dropdown)
    ruleDescVarCasing: vscode.l10n.t('Unify the casing of the same local variable — for example sDim, SDIM, and Sdim all become one spelling.'),
    ruleDescParamCasing: vscode.l10n.t('Unify the casing of a process parameter across its uses, and update the parameter declaration to match.'),
    ruleDescDatasourceCasing: vscode.l10n.t('Unify the casing of a datasource variable across its uses, and update the variable declaration to match.'),
    ruleDescFunctionCasing: vscode.l10n.t('Correct TI function names to their canonical casing — for example cellputn becomes CellPutN.'),
    ruleDescKeywordCasing: vscode.l10n.t('Make control-flow keywords uppercase — if becomes IF, End becomes END.'),
    ruleDescNaming: vscode.l10n.t('Bring names to the n / s / p / v prefix convention (numeric n, string s, parameter p, datasource v).'),
    // static body — rule dropdown
    varCasing: vscode.l10n.t('Variable Casing'),
    paramCasing: vscode.l10n.t('Parameter Casing'),
    datasourceCasing: vscode.l10n.t('Datasource Casing'),
    functionCasing: vscode.l10n.t('Function Casing'),
    keywordCasing: vscode.l10n.t('Keyword Casing'),
    namingConvention: vscode.l10n.t('Naming n/s/p/v'),
    variableNaming: vscode.l10n.t('Variable Naming'),
    paramNaming: vscode.l10n.t('Parameter Naming'),
    datasourceNaming: vscode.l10n.t('Datasource Naming'),
    ruleDescVariableNaming: vscode.l10n.t('Prefix local variables by inferred type (numeric, string). Uses the naming prefixes shared with the linter — edit below.'),
    ruleDescParamNaming: vscode.l10n.t('Prefix process parameters. Uses the naming prefix shared with the linter — edit below.'),
    ruleDescDatasourceNaming: vscode.l10n.t('Prefix datasource variables. Uses the naming prefix shared with the linter — edit below.'),
    prefixCfgNote: vscode.l10n.t('Prefixes (shared with the linter):'),
    prefixNumeric: vscode.l10n.t('numeric'),
    prefixString: vscode.l10n.t('string'),
    prefixParam: vscode.l10n.t('parameter'),
    prefixDatasource: vscode.l10n.t('datasource'),
    // static body — filters + actions
    prefixPlaceholder: vscode.l10n.t('prefix'),
    containsPlaceholder: vscode.l10n.t('contains'),
    suffixPlaceholder: vscode.l10n.t('suffix'),
    includeControl: vscode.l10n.t('Include control objects'),
    listBtn: vscode.l10n.t('List'),
    scanBtn: vscode.l10n.t('Scan'),
    applyAllBtn: vscode.l10n.t('Apply all'),
    applyAllConfirm: vscode.l10n.t('Apply all {0} findings to the selected processes? This writes to TM1.'),
    procListEmpty: vscode.l10n.t('List processes above to choose which to scan.'),
    // client runtime — group buttons + process list
    previewBtn: vscode.l10n.t('Preview'),
    applyBtn: vscode.l10n.t('Apply'),
    allLabel: vscode.l10n.t('(all)'),
    countLabel: vscode.l10n.t('{0} of {1} selected'),
    noGroups: vscode.l10n.t('No inconsistencies found. Adjust the rule or the selected processes and scan again.'),
    // client runtime — status text, `{0}`/`{1}` filled client-side
    unreadableLabel: vscode.l10n.t('Unreadable: {0}'),
    invalidTarget: vscode.l10n.t('Invalid target: {0}'),
    previewEditsLabel: vscode.l10n.t('Preview -> edits: {0}'),
    skippedSuffix: vscode.l10n.t('skipped: {0}'),
    appliedLabel: vscode.l10n.t('Applied: {0}'),
    failedSuffix: vscode.l10n.t('FAILED {0}: {1}'),
    noneLabel: vscode.l10n.t('(none)'),
  };
}
