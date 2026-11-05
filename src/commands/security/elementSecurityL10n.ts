// src/commands/security/elementSecurityL10n.ts
// Resolved UI strings for the Element Security webview. The body markup
// (`buildSecurityMatrixBody`) and the client (`window.__l10n`) share this single
// map, so each English source string is translated once. Keys are stable JS
// identifiers; the `vscode.l10n.t(...)` argument is the localization key (English
// source = key, per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildElementSecurityL10n(): L10nMap {
  return {
    // static body
    // Keys follow the shared matrix (`securityMatrixL10n.ts`): the body and
    // `_shared/securityMatrixCore` read them by these names.
    title: vscode.l10n.t('Element Security:'),
    unsavedChanges: vscode.l10n.t('unsaved changes'),
    refresh: vscode.l10n.t('Refresh'),
    revert: vscode.l10n.t('Revert'),
    save: vscode.l10n.t('Save'),
    tabSelection: vscode.l10n.t('Selection'),
    tabMatrix: vscode.l10n.t('Matrix'),
    tabView: vscode.l10n.t('View'),
    missingBanner: vscode.l10n.t('Element Security cube missing.'),
    create: vscode.l10n.t('Create'),
    filterLabel: vscode.l10n.t('Element:'),
    entityLabel: vscode.l10n.t('Element'),
    filterPlaceholder: vscode.l10n.t('filter by name…'),
    noGroupsLoaded: vscode.l10n.t('No groups loaded.'),
    loading: vscode.l10n.t('Loading…'),
    // client runtime
    creatingCube: vscode.l10n.t('Creating cube…'),
    selectGroupsHint: vscode.l10n.t('Select one or more groups (chips above) to start editing.'),
    // No placeholder: `fmt` returns it unchanged, so no plural label is needed.
    noMatchFilter: vscode.l10n.t('No elements match the filter.'),
    cubeMissingCreateAbove: vscode.l10n.t('Cube missing — please create it above.'),
    refreshed: vscode.l10n.t('Refreshed'),
    // `{0}` filled client-side.
    createFailed: vscode.l10n.t('Create failed: {0}'),
    savedChanges: vscode.l10n.t('Saved {0} change(s)'),
    savedPartial: vscode.l10n.t('{0} saved, {1} failed'),
    // `{0}` rows shown, `{1}` rows matching.
    rowsCapped: vscode.l10n.t('Showing {0} of {1} rows — narrow the list with the filter.'),
    // `{0}` filled with the dimension name.
    cubeMissingForDim: vscode.l10n.t("Element Security cube for '{0}' is missing."),
  };
}
