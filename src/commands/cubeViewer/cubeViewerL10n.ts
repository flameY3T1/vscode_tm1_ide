// src/commands/cubeViewer/cubeViewerL10n.ts
// Resolved UI strings for the Cube Viewer webview. The static body markup
// (`getCubeViewerBody`) and the client bundle (`window.__l10n`) share this single
// map, so every English source string is translated once. Property names are
// stable JS identifiers (body/client reference them); the `vscode.l10n.t(...)`
// argument is the English source = the localization key (Phase 2 convention).
// DE translations live in `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildCubeViewerL10n(): L10nMap {
  return {
    // ── Action bar ────────────────────────────────────────────
    // The button used to be called "Reload" — the word promised more than it
    // does: it refreshes the NUMBERS and keeps the working state (filters,
    // context). The button next to it (`reloadView`) reads the saved view
    // fresh from the server, and that one deliberately discards the working
    // state.
    reload: vscode.l10n.t('Refresh'),
    viewLabel: vscode.l10n.t('View:'),
    loadSavedView: vscode.l10n.t('Load a saved view'),
    filterByName: vscode.l10n.t('Filter by name…'),
    swapAxes: vscode.l10n.t('Swap axes'),
    swapAxesTitle: vscode.l10n.t('Swap rows and columns — the loaded values are re-arranged, not read again'),
    reloadView: vscode.l10n.t('Reload view'),
    reloadViewTitle: vscode.l10n.t('Read the selected view from the server again — filters and context picks are discarded'),
    ownSelection: vscode.l10n.t('— Custom selection —'),
    saveView: vscode.l10n.t('Save view…'),
    saveViewTitle: vscode.l10n.t('Save the current axis configuration as a view'),
    exportCsv: vscode.l10n.t('Export CSV'),
    mdxTitle: vscode.l10n.t('Show the MDX query for the current view'),
    suppressColsTitle: vscode.l10n.t('Hide zero columns'),
    suppressCols: vscode.l10n.t('0 columns'),
    suppressRowsTitle: vscode.l10n.t('Hide zero rows'),
    suppressRows: vscode.l10n.t('0 rows'),
    autoRefresh: vscode.l10n.t('Auto-refresh'),

    // ── Zones ─────────────────────────────────────────────────
    titles: vscode.l10n.t('Titles'),
    rows: vscode.l10n.t('Rows'),
    cols: vscode.l10n.t('Columns'),

    // ── Loading / placeholder ─────────────────────────────────
    loading: vscode.l10n.t('Loading…'),
    placeholder: vscode.l10n.t('Drag dimensions onto rows / columns, then click “Refresh”'),

    // ── Context menu (cell / dimension) ───────────────────────
    keepOnly: vscode.l10n.t('Show only this element'),
    showParents: vscode.l10n.t('Show parent'),
    showAllParents: vscode.l10n.t('Show all parents'),
    expandAll: vscode.l10n.t('Expand fully'),
    leaves: vscode.l10n.t('All N descendants'),
    elemPlusLeaves: vscode.l10n.t('Element + N elements'),
    copyName: vscode.l10n.t('Copy name'),
    copyMdx: vscode.l10n.t('Copy as MDX member'),
    openDimension: vscode.l10n.t('Open dimension…'),
    aliasMenu: vscode.l10n.t('Alias'),
    noAlias: vscode.l10n.t('(no alias)'),
    clearFilter: vscode.l10n.t('Clear filter/selection'),

    // dynamic context-menu labels (suffix filled client-side)
    keepOnlyOne: vscode.l10n.t('Show only this element{0}'),
    keepOnlyMany: vscode.l10n.t('Show only these elements{0}'),
    showParentSuffix: vscode.l10n.t('Show parent{0}'),
    showAllParentsSuffix: vscode.l10n.t('Show all parents{0}'),
    expandAllSuffix: vscode.l10n.t('Expand fully{0}'),
    leavesSuffix: vscode.l10n.t('All N descendants{0}'),
    elemPlusLeavesSuffix: vscode.l10n.t('Element + N elements{0}'),
    copyNameMany: vscode.l10n.t('Copy names ({0})'),

    // ── Spread menu / prompt ──────────────────────────────────
    spreadProportional: vscode.l10n.t('Spread proportionally'),
    spreadRepeat: vscode.l10n.t('Value to all leaves'),
    spreadPercentage: vscode.l10n.t('Adjust by percentage'),
    spreadClear: vscode.l10n.t('Set all leaves to 0 (clear)'),
    traceRule: vscode.l10n.t('Trace rule calculation'),
    traceFeeders: vscode.l10n.t('Trace feeders'),
    traceCheckFeeders: vscode.l10n.t('Check feeders (unfed)'),
    spread: vscode.l10n.t('Spread'),
    spreadValueLabel: vscode.l10n.t('Value:'),
    spreadTargetLabel: vscode.l10n.t('Target value:'),
    spreadPercentLabel: vscode.l10n.t('Percent (±):'),
    valueRequired: vscode.l10n.t('Value required.'),
    mustBeNumber: vscode.l10n.t('Must be a number.'),
    noWritableCells: vscode.l10n.t('No writable C cells in the selection.'),

    // ── Format dialog (display formats, grid only) ─────────────
    fmtMenu: vscode.l10n.t("Format…"),
    fmtServer: vscode.l10n.t("Server format"),
    fmtServerTitle: vscode.l10n.t("Show the server's own formatting again"),
    fmtTitle: vscode.l10n.t("Format: {0}"),
    fmtApplyTo: vscode.l10n.t("Apply to"),
    fmtElementsN: vscode.l10n.t("{0} elements"),
    fmtDecimals: vscode.l10n.t("Decimals"),
    fmtGroup: vscode.l10n.t("Thousands separator"),
    fmtNegative: vscode.l10n.t("Negative numbers"),
    fmtZero: vscode.l10n.t("Zero"),
    fmtZeroBlank: vscode.l10n.t("blank"),
    fmtUnit: vscode.l10n.t("Unit"),
    fmtScale: vscode.l10n.t("Scale"),
    fmtScaleTitle: vscode.l10n.t("TM1 scales only without decimals, so a scale sets the decimals to 0."),
    fmtScaleNone: vscode.l10n.t("none"),
    fmtScaleK: vscode.l10n.t("thousands"),
    fmtScaleM: vscode.l10n.t("millions"),
    fmtPercent: vscode.l10n.t("Percent (× 100)"),
    fmtPattern: vscode.l10n.t("Format string (TM1 FORMAT_STRING)"),
    fmtRaw: vscode.l10n.t("Value"),
    fmtShown: vscode.l10n.t("Shown"),
    fmtDisplayOnly: vscode.l10n.t("Display only: changes how this window shows the numbers, not the data or the view on the server."),
    fmtReset: vscode.l10n.t("Remove format"),
    fmtApply: vscode.l10n.t("Apply"),
    fmtErrEmpty: vscode.l10n.t("Enter a format."),
    fmtErrSections: vscode.l10n.t("At most three sections: positive;negative;zero."),
    fmtErrExpression: vscode.l10n.t("TM1 does not accept an expression as a format."),
    fmtErrUnquoted: vscode.l10n.t("Put text in double quotes: TM1 shows \"error\" for {0} outside quotes."),
    fmtErrQuote: vscode.l10n.t("A quote is not closed."),
    fmtErrColour: vscode.l10n.t("TM1 does not support colours in a format ([Red] and the like)."),
    fmtErrNamed: vscode.l10n.t("Named formats (Standard, Percent, …) show \"error\" on TM1; use a pattern such as #,##0.00."),
    fmtErrPrefix: vscode.l10n.t("The prefix {0} belongs to the element attribute Format, not to a format string."),
    fmtErrTime: vscode.l10n.t("{0} outside a date turns the format into a time pattern; TM1 then shows nothing."),
    fmtErrNoDigits: vscode.l10n.t("The format needs at least one digit placeholder (0 or #)."),
    fmtTitleAttr: vscode.l10n.t("Format attribute: {0}"),
    fmtToServer: vscode.l10n.t("Save as element format (server)"),
    fmtToServerTitle: vscode.l10n.t("Writes the Format attribute of these elements on the server; it applies in every view and tool."),
    fmtServerLoading: vscode.l10n.t("Reading the element format from the server…"),
    fmtAttrNone: vscode.l10n.t("No element format on the server."),
    fmtAttrStored: vscode.l10n.t("Element format on the server: {0}."),
    fmtAttrOk: vscode.l10n.t("TM1 applies it."),
    fmtAttrLegacyBreaks: vscode.l10n.t("With the prefix d: TM1 shows \"error\" or quotes for this pattern; saving writes b: instead."),
    fmtAttrIgnored: vscode.l10n.t("TM1 ignores it: without the prefix b: or c: the attribute has no effect."),
    fmtAttrMixed: vscode.l10n.t("The selected elements have different element formats on the server."),
    fmtAttrReadFailed: vscode.l10n.t("Could not read the element format: {0}"),
    fmtAttrWriteFailed: vscode.l10n.t("Could not write the element format: {0}"),
    fmtAttrWritten: vscode.l10n.t("Element format saved on the server."),
    fmtAttrCellWritten: vscode.l10n.t("Format attribute written."),
    fmtSave: vscode.l10n.t("Put display formats into the MDX"),
    fmtSaveTitle: vscode.l10n.t("Each formatted element becomes a calculated member with FORMAT_STRING that refers to the original."),
    fmtSaveNote: vscode.l10n.t("Formatted rows and columns show the same values. PAW and other tools cannot write to them; this viewer writes to the original cells as before."),
    fmtSaveCross: vscode.l10n.t("Where two formatted elements cross, TM1 uses the format of the dimension that comes first in the cube."),
    fmtSaveNativeOnly: vscode.l10n.t("Display formats can only be saved in an MDX view; a native view keeps them in this window only."),
    fmtSaveSkipped: vscode.l10n.t("Not in the MDX (not a plain element of an axis): {0}"),

    // ── MDX modal ─────────────────────────────────────────────
    copy: vscode.l10n.t('Copy'),
    format: vscode.l10n.t('Format'),
    openInMdxRunner: vscode.l10n.t('Open in MDX Runner'),
    run: vscode.l10n.t('Run'),
    close: vscode.l10n.t('Close'),
    mdxEmpty: vscode.l10n.t('MDX empty'),
    mdxCopied: vscode.l10n.t('MDX copied'),
    mdxBuildFailed: vscode.l10n.t('MDX build failed: {0}'),
    saveMdxView: vscode.l10n.t('Save MDX view…'),
    mdxLossWarn: vscode.l10n.t('Pivot regenerated the MDX — calculated members / WITH clauses will be lost. Save anyway?'),

    // ── View-save modal ───────────────────────────────────────
    saveViewHeading: vscode.l10n.t('Save view'),
    // Same wording as in the Dimension Browser — the same bundle key, one
    // entry for both places.
    saveAsMdx: vscode.l10n.t('Save as MDX'),
    saveAsMdxTitle: vscode.l10n.t('Store the view as an MDX expression instead of a native view'),
    name: vscode.l10n.t('Name'),
    privatePrivate: vscode.l10n.t('Private (only me)'),
    public: vscode.l10n.t('Public'),
    overwriteExisting: vscode.l10n.t('Overwrite existing view'),
    cancel: vscode.l10n.t('Cancel'),
    save: vscode.l10n.t('Save'),
    needRowAndColDim: vscode.l10n.t('At least one dimension in rows and columns is required.'),
    saved: vscode.l10n.t('Saved.'),
    saveFailed: vscode.l10n.t('Save failed.'),
    enterName: vscode.l10n.t('Please enter a name.'),
    saving: vscode.l10n.t('Saving…'),

    // ── Axis chips ────────────────────────────────────────────
    changeSelection: vscode.l10n.t('Change element selection'),
    selectElements: vscode.l10n.t('Select elements'),
    moveToTitle: vscode.l10n.t('Move to title'),
    remove: vscode.l10n.t('Remove'),
    hierarchy: vscode.l10n.t('Hierarchy'),
    defaultHierarchy: vscode.l10n.t('Default'),
    addHierarchy: vscode.l10n.t('Add another hierarchy of this dimension'),
    selectPlaceholder: vscode.l10n.t('Select…'),
    filterElements: vscode.l10n.t('Filter elements…'),
    noMatches: vscode.l10n.t('No matches'),

    // ── View picker optgroups ─────────────────────────────────
    publicGroup: vscode.l10n.t('Public'),
    privateGroup: vscode.l10n.t('Private'),

    // ── Grid banners / counts ─────────────────────────────────
    cappedColsOnly: vscode.l10n.t('Display limited to {0} columns.'),
    pagedCount: vscode.l10n.t('{0} / {1} rows (scroll to load more) × {2}'),
    cellCount: vscode.l10n.t('{0} × {1} cells'),
    cells: vscode.l10n.t('cells'),

    // ── Cell-edit errors / toasts ─────────────────────────────
    error: vscode.l10n.t('Error'),
    errorPrefix: vscode.l10n.t('Error: {0}'),
    ruleCellNotWritable: vscode.l10n.t('Rule cell is not writable.'),
    cellNotWritable: vscode.l10n.t('Cell is not writable (security/lock).'),
    cellWriteProtected: vscode.l10n.t('Cell write-protected: {0}'),
    noPermission: vscode.l10n.t('No permission'),
    unknown: vscode.l10n.t('Unknown'),

    // ── Picklist editor ────────────────────────────────────────
    picklistForeignValue: vscode.l10n.t('{0} (not in list)'),

    // ── Spread result toasts ──────────────────────────────────
    spreadOk: vscode.l10n.t('Spread OK — view refreshed'),
    spreadOkCount: vscode.l10n.t('Spread OK — {0} cells'),
    unknownError: vscode.l10n.t('Unknown error'),
    spreadFailed: vscode.l10n.t('Spread failed'),
    invalid: vscode.l10n.t('Invalid'),
    noWriteRight: vscode.l10n.t('No write permission'),
    endpointUnavailable: vscode.l10n.t('Endpoint unavailable'),
    serverError: vscode.l10n.t('Server error'),
    sessionExpired: vscode.l10n.t('Session expired — reconnect to the server'),
    networkError: vscode.l10n.t('Network error'),
    spreadBulkError: vscode.l10n.t('{0} at cell {1}/{2}: {3}'),
    alreadyApplied: vscode.l10n.t(' ({0} already applied)'),

    // ── Paste toasts ───────────────────────────────────────────
    pasteNoAnchor: vscode.l10n.t('Click a cell first, then paste.'),
    pasteDoesNotFit: vscode.l10n.t('{0} rows × {1} columns pasted, but only {2} × {3} fit below the selected cell — nothing pasted.'),
    pasteBlockedConsolidated: vscode.l10n.t('A consolidated cell is in the way — nothing pasted.'),
    pasteBlockedRule: vscode.l10n.t('A rule cell is in the way — nothing pasted.'),
    pasteBlockedLocked: vscode.l10n.t('A locked cell is in the way — nothing pasted.'),
    pasteOk: vscode.l10n.t('{0} cells written'),
    pastePicklistRejected: vscode.l10n.t('{0} value(s) are not on the picklist — those cells were skipped.'),
    pasteStaleView: vscode.l10n.t('The view changed while checking picklists — paste again.'),

    // ── Clear (Delete key) toasts ──────────────────────────────
    clearBlockedConsolidated: vscode.l10n.t('A consolidated cell is in the selection — nothing cleared.'),
    clearBlockedRule: vscode.l10n.t('A rule cell is in the selection — nothing cleared.'),
    clearBlockedLocked: vscode.l10n.t('A locked cell is in the selection — nothing cleared.'),
    clearOk: vscode.l10n.t('{0} cells cleared'),
  };
}
