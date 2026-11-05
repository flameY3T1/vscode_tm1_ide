// src/commands/security/securityMatrixL10n.ts
// Resolved UI strings shared by the Cube / Dimension / Process security-matrix
// webviews. All three share an identical matrix UI, so they reuse one builder.
// The `vscode.l10n.t(...)` argument is the English source = the localization key
// (Phase 2 convention); DE translations live in `l10n/bundle.l10n.de.json`.
// Static body markup and the client engine (`_shared/securityMatrixCore`) both
// read from the same map (the latter via `window.__l10n` / `getL10n()`).
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/**
 * Build the shared security-matrix string map. `title`, `entityLabel` and
 * `entityLabelPlural` are variant-specific and supplied by the caller (already
 * localized English source strings).
 */
export function buildSecurityMatrixL10n(opts: {
  title: string;
  entityLabel: string;
  entityLabelPlural: string;
}): L10nMap {
  return {
    // static body (variant-specific labels supplied by caller)
    title: opts.title,
    entityLabel: opts.entityLabel,
    entityLabelPlural: opts.entityLabelPlural,
    unsavedChanges: vscode.l10n.t('unsaved changes'),
    refresh: vscode.l10n.t('Refresh'),
    revert: vscode.l10n.t('Revert'),
    save: vscode.l10n.t('Save'),
    tabSelection: vscode.l10n.t('Selection'),
    tabMatrix: vscode.l10n.t('Matrix'),
    tabView: vscode.l10n.t('View'),
    filterPlaceholder: vscode.l10n.t('filter by name…'),
    noGroupsLoaded: vscode.l10n.t('No groups loaded.'),
    loading: vscode.l10n.t('Loading…'),
    // client runtime
    selectGroupsHint: vscode.l10n.t('Select one or more groups (chips above) to start editing.'),
    noMatchFilter: vscode.l10n.t('No {0} match the filter.'),
    refreshed: vscode.l10n.t('Refreshed'),
    savedChanges: vscode.l10n.t('Saved {0} change(s)'),
    savedPartial: vscode.l10n.t('{0} saved, {1} failed'),
    // `{0}` rows shown, `{1}` rows matching.
    rowsCapped: vscode.l10n.t('Showing {0} of {1} rows — narrow the list with the filter.'),
  };
}
