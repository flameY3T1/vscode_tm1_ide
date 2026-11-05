// src/commands/dimension/dimensionBrowserL10n.ts
// Resolved UI strings for the Dimension Browser webview. The body markup
// (`buildDimensionBrowserBody`) and the client (`window.__l10n`) share this
// single map, so each English source string is translated once. Keys are stable
// JS identifiers; the `vscode.l10n.t(...)` argument is the localization key
// (English source = key, per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildDimensionBrowserL10n(): L10nMap {
  return {
    // ── Controls bar ──────────────────────────────────────────
    dimensionLabel: vscode.l10n.t('Dimension:'),
    loadingOption: vscode.l10n.t('— loading —'),
    hierarchyLabel: vscode.l10n.t('Hierarchy:'),
    subsetLabel: vscode.l10n.t('Subset:'),
    subsetSelectTitle: vscode.l10n.t('Restrict the element list to a subset'),
    filterByName: vscode.l10n.t('Filter by name…'),
    // filterCombo.ts (subset picker) reads these three.
    selectPlaceholder: vscode.l10n.t('Select…'),
    filterElements: vscode.l10n.t('Filter elements…'),
    noMatches: vscode.l10n.t('No matches'),
    optAll: vscode.l10n.t('— All —'),
    optNLevel: vscode.l10n.t('N elements (Level 0)'),
    optTopLevel: vscode.l10n.t('Top-level only (roots)'),
    refreshTitle: vscode.l10n.t('Reload'),
    attrCubeTitle: vscode.l10n.t('Open attribute cube ( }ElementAttributes_<Dim> )'),
    attrCube: vscode.l10n.t('Attribute cube'),
    dimEditorTitle: vscode.l10n.t('Open this dimension/hierarchy in the dimension editor'),
    dimEditor: vscode.l10n.t('Edit dimension'),
    mdxTitle: vscode.l10n.t('Show current subset as an MDX expression'),
    saveSubsetTitle: vscode.l10n.t('Save selected elements as a subset'),
    saveSubsetBtn: vscode.l10n.t('Save subset…'),

    // ── Search + filter bar ───────────────────────────────────
    filterPlaceholder: vscode.l10n.t('Filter elements (wildcards: * ? supported)…'),
    displayLabel: vscode.l10n.t('Display:'),
    aliasSelectTitle: vscode.l10n.t('Show element as alias'),
    optName: vscode.l10n.t('— Name —'),
    sortLabel: vscode.l10n.t('Sort:'),
    sortSelectTitle: vscode.l10n.t('Element sort order'),
    sortNone: vscode.l10n.t('None'),
    sortHierarchy: vscode.l10n.t('Hierarchy'),
    sortNameAsc: vscode.l10n.t('Name ↑ (A-Z)'),
    sortNameDesc: vscode.l10n.t('Name ↓ (Z-A)'),
    sortIndexAsc: vscode.l10n.t('Index ↑'),
    sortIndexDesc: vscode.l10n.t('Index ↓'),
    sortIndexNoResult: vscode.l10n.t('Sorting by index returned no elements — the row order is unchanged.'),
    sortIndexNoExpression: vscode.l10n.t('Sorting by index found no expression that describes the current view.'),
    sortIndexPaged: vscode.l10n.t('Sorting by index needs an expression for the whole view — only part of this large dimension is loaded, and the loaded rows are not the view. Pick a subset or a filter first.'),
    sortHierarchyNotExpressible: vscode.l10n.t('"Hierarchy" only reorders the display here — the MDX expression gets no HIERARCHIZE, because the row order comes from a hand-ordered list, or because the hierarchy edges are not loaded (rows arrive page by page).'),
    levelLabel: vscode.l10n.t('Level:'),
    levelFilterTitle: vscode.l10n.t('Multi-select with Ctrl/Cmd'),
    attributeLabel: vscode.l10n.t('Attribute:'),
    optNone: vscode.l10n.t('— none —'),
    valueContainsPlaceholder: vscode.l10n.t('Value contains…'),
    quickOnlyNTitle: vscode.l10n.t('Show only N leaves (Level 0)'),
    quickOnlyN: vscode.l10n.t('Only N'),
    quickOnlyCTitle: vscode.l10n.t('Only consolidations'),
    quickOnlyC: vscode.l10n.t('Only C'),
    quickOnlySTitle: vscode.l10n.t('Only string elements'),
    quickOnlyS: vscode.l10n.t('Only S'),
    keepMarked: vscode.l10n.t('Keep'),
    removeMarked: vscode.l10n.t('Remove'),
    // Toolbar dropdown: calls the same drill actions as the context menu,
    // with the row context coming from the marks or the active row.
    // "All": the only documented way back out of deletions and drills — there
    // is deliberately no undo (spec E7).
    showAll: vscode.l10n.t('All'),
    showAllTitle: vscode.l10n.t('Reset filters, deletions and drills — show every element'),

    // ── Loading / placeholder ─────────────────────────────────
    loading: vscode.l10n.t('Loading…'),
    placeholder: vscode.l10n.t('Select a dimension and hierarchy'),

    // ── Pane ────────────────────────────────────────────────────
    // Header-line marker of the list state: the list then shows the selection
    // in the order the user dragged it into, and filter and sorting have no
    // effect there.
    paneManualOrder: vscode.l10n.t('Custom order'),
    // ── Dynamic (MDX-driven) subset marker ────────────────────
    // The UI now only says "MDX", no longer "dynamic": two words for the same
    // thing, and "dynamic" does not explain anything the expression does not
    // show by itself. The KEYS are still called `*Dynamic*` — renaming them
    // would move dozens of hits across the webview and tests without any
    // user ever seeing it.
    subsetDynamicTag: vscode.l10n.t('MDX'),
    subsetDynamicTitle: vscode.l10n.t('Subset from an MDX expression'),
    // Label of the bar when there currently is NO expression and it instead
    // names the reason (the actual texts are the `dynSave*` ones below — the
    // same situation as in the save dialog, just earlier).
    subsetMdxNoneTag: vscode.l10n.t('no MDX'),
    subsetMdxUnread: vscode.l10n.t('The MDX rule of this subset could not be read — it is unknown whether it has one.'),
    subsetMdxUnreadTag: vscode.l10n.t('MDX unknown'),
    // Marker bar: the effective MDX no longer matches what the server stores.
    subsetMdxChangedTag: vscode.l10n.t('changed'),
    // Tooltip of the marker bar in that case — {0} = server stand, {1} = effective
    // MDX. This tooltip IS the second access path to the original expression.
    subsetMdxChangedTitle: vscode.l10n.t('Original (on the server):\n{0}\n\nCurrent (would be saved):\n{1}'),
    subsetTooLargeToPreload: vscode.l10n.t('The subset holds {0} elements — too many to list; showing the filtered tree instead.'),

    // ── Selection footer ──────────────────────────────────────
    cancel: vscode.l10n.t('Cancel'),
    confirm: vscode.l10n.t('Apply'),

    // ── Context menu ──────────────────────────────────────────
    ctxOnlyThis: vscode.l10n.t('Show only this element'),
    ctxOnlyThese: vscode.l10n.t('Only these elements{0}'),
    ctxShowParents: vscode.l10n.t('Show parent'),
    ctxShowAllParents: vscode.l10n.t('Show all parents'),
    ctxLeavesTitle: vscode.l10n.t('All N (leaf) descendants in the subtree'),
    ctxLeaves: vscode.l10n.t('All N descendants'),
    ctxElemPlusLeavesTitle: vscode.l10n.t('The element plus its N leaves'),
    ctxElemPlusLeaves: vscode.l10n.t('Element + N elements'),
    ctxInsertAboveTitle: vscode.l10n.t('Insert the clipboard element names above this row'),
    ctxInsertAbove: vscode.l10n.t('Insert above'),
    ctxInsertBelowTitle: vscode.l10n.t('Insert the clipboard element names below this row'),
    ctxInsertBelow: vscode.l10n.t('Insert below'),
    ctxExpandAll: vscode.l10n.t('Expand fully'),
    ctxExpandToLevelTitle: vscode.l10n.t('Drill down to level N'),
    ctxExpandToLevel: vscode.l10n.t('Drill to level…'),
    ctxLevelN: vscode.l10n.t('Level {0}'),
    ctxLevelLeaves: vscode.l10n.t('Level 0 (leaves)'),
    ctxClearAll: vscode.l10n.t('Clear filter / selection'),
    ctxCollapseAll: vscode.l10n.t('Collapse all'),
    ctxCopyName: vscode.l10n.t('Copy name'),
    ctxCopyMdx: vscode.l10n.t('Copy as MDX member'),

    // ── Status footer ─────────────────────────────────────────
    statVisible: vscode.l10n.t('visible'),
    statTotal: vscode.l10n.t('total'),

    // ── MDX modal ─────────────────────────────────────────────
    mdxSubset: vscode.l10n.t('MDX subset'),
    mdxFormat: vscode.l10n.t('Format'),
    mdxCopy: vscode.l10n.t('Copy'),
    mdxOpenRunner: vscode.l10n.t('Open in MDX Runner'),
    mdxRun: vscode.l10n.t('Run'),
    mdxClose: vscode.l10n.t('Close'),
    mdxBuildFailed: vscode.l10n.t('// MDX generation failed — see DevTools console'),

    // ── Save modal ────────────────────────────────────────────
    saveSubsetTitleModal: vscode.l10n.t('Save subset'),
    nameLabel: vscode.l10n.t('Name'),
    savePrivate: vscode.l10n.t('Private (only me)'),
    savePublic: vscode.l10n.t('Public'),
    saveOverwrite: vscode.l10n.t('Overwrite existing subset'),
    saveDynamic: vscode.l10n.t('Save as MDX'),
    // Shown instead of the MDX preview when the checkbox is greyed out — a
    // disabled option without a reason reads as a broken dialog.
    saveDynamicNoDrill: vscode.l10n.t('No drill-down context — saved as a fixed element list.'),
    saveDynamicChanged: vscode.l10n.t('Selection was changed manually — saved as a fixed element list.'),
    // Multi-drill mix case (Task 5): some drills still describe the selection,
    // others were degraded by a hand edit. Save stays dynamic — shown alongside
    // a still-ticked, still-enabled checkbox, unlike the two hints above.
    dynSavePartial: vscode.l10n.t('{0} of {1} selections stay as MDX — the edited ones are stored as fixed members'),
    dynSaveAllDemoted: vscode.l10n.t('Selection was edited by hand — no rule left to store'),
    // Task 8: the composition machine (`composeCurrent`) named a concrete reason
    // why the current state cannot stay a dynamic expression — shown alongside
    // a disabled checkbox, same as the two hints above.
    dynSaveDuplicates: vscode.l10n.t('The selection contains an element more than once — an MDX expression cannot express that.'),
    dynSaveTooManyMoves: vscode.l10n.t('Too many hand-moved rows for a readable expression.'),
    // Separate from `dynSaveTooManyMoves`, even though the same number is
    // behind it: here the user has moved NOTHING. The rows repeat because a
    // child hangs under several parents and the tree shows it under each one
    // — a fact about the data, not an action. The old text read as an accusation.
    dynSaveSharedElements: vscode.l10n.t('Some elements hang under several parents and appear more than once in the tree — the hierarchy order cannot be expressed exactly enough for a dynamic expression.'),
    dynSaveNotExpressible: vscode.l10n.t('The selection cannot be described as an expression.'),
    dynSaveWindowLimited: vscode.l10n.t('The collapsed block runs past the rows loaded so far — load more rows or narrow the view before saving it as an expression.'),
    // The expression builds on exactly the subset it would overwrite. TM1
    // accepts that without comment (live 11.8, HTTP 200) — and the subset
    // then only resolves the elements that were added alongside it anymore.
    dynSaveBaseIsTarget: vscode.l10n.t('The expression builds on this subset — saving it under the same name would erase its members. Saved as a fixed element list instead.'),
    save: vscode.l10n.t('Save'),

    // ── Client runtime ────────────────────────────────────────
    optDefaultElement: vscode.l10n.t('Default element'),
    optgroupPublic: vscode.l10n.t('Public'),
    optgroupPrivate: vscode.l10n.t('Private'),
    levelOption: vscode.l10n.t('Level {0}'),
    noVisibleElements: vscode.l10n.t('No visible elements — adjust the filter.'),
    enterName: vscode.l10n.t('Please enter a name.'),
    savingEllipsis: vscode.l10n.t('Saving…'),
    saved: vscode.l10n.t('Saved.'),
    saveFailed: vscode.l10n.t('Save failed.'),
    unknownError: vscode.l10n.t('Unknown error'),
    mdxSubsetError: vscode.l10n.t('MDX subset error: {0}'),
    markedCount: vscode.l10n.t('{0} marked'),
    markedApplyHint: vscode.l10n.t('{0} marked (Apply sends the marked ones)'),
    allNoFilter: vscode.l10n.t('All (no filter)'),
    visibleOfTotal: vscode.l10n.t('{0} / {1} visible'),
    searchHits: vscode.l10n.t('{0} hits (server filter, max. page)'),
    loadedSubset: vscode.l10n.t('{0} of {1} (subset) loaded'),
    loaded: vscode.l10n.t('{0} of {1} loaded'),
    subsetCount: vscode.l10n.t('{0} / {1} (subset)'),
    visibleElements: vscode.l10n.t('{0} / {1} elements'),
    totalElements: vscode.l10n.t('{0} elements'),
    serverSearchPlaceholder: vscode.l10n.t('Search name on the server — Enter (whole dimension)…'),
    // M2: drill-to-level came back empty — info toast (not an error).
    drillNoElementsAtLevel: vscode.l10n.t('No elements found at that level.'),
    // M3: collapse-all / top-level cleared active quick-filters — hint toast.
    collapseFiltersCleared: vscode.l10n.t('Filters cleared — showing top level.'),
    // Subset pick: a filter from the previous subset can hide the new one
    // completely, so it gets dropped — but not silently.
    subsetFiltersCleared: vscode.l10n.t('Filters cleared — showing the selected subset.'),
    // K12: Ctrl+V pasted names the client does not know. In paged mode that means
    // "from a page that was never loaded", not "does not exist" — say so instead of
    // dropping them silently.
    pasteNamesNotFound: vscode.l10n.t('{0} pasted names are not among the loaded elements — skipped.'),
    // K3: the outline lookup is capped, so beyond it rows render flat. Say it
    // once instead of letting the missing indentation look like a bug.
    memberStructureCapped: vscode.l10n.t('{0} further rows stay flat — the structure lookup is capped.'),
    // Plan 3 review, Important 1: while the new view path is active, the four
    // legacy controls (hierarchy dropdown, refresh, filters, reset-all) still
    // post `fetchElements` and would silently pull the old renderer back over
    // the new one. Deliberately blocked instead of wired up — Plan 4 gives
    // them their own path.
    newViewPathControlUnavailable: vscode.l10n.t('Not available yet in the new load path.'),

    // ── New load path: controls, trail, banners ───────────────
    // These were hard-coded German behind the `newPath` flag ("translated in
    // plan 9"). Rejected 2026-08-22: the extension is English source + DE
    // bundle throughout, and parking German strings in the code only means
    // rewriting them to English later. Button and trail share one label per
    // base, so the same thing is never called two names.
    // "Members", not "Tree": the base IS `.Members` in MDX, and every
    // occurrence is in it once. The button's technical name has always been
    // `vw-btn-base-members`.
    vwBaseMembers: vscode.l10n.t('Members'),
    vwBaseMembersTitle: vscode.l10n.t('Base: the members — every occurrence once'),
    vwBaseAll: vscode.l10n.t('All'),
    vwBaseAllTitle: vscode.l10n.t('Base: the element set — every element once'),
    vwBaseRoots: vscode.l10n.t('Roots'),
    vwBaseMdx: vscode.l10n.t('MDX'),
    vwBaseLeaves: vscode.l10n.t('leaves of {0}'),
    vwBaseElemLeaves: vscode.l10n.t('{0} and its leaves'),
    vwBaseToLevel: vscode.l10n.t('{0} down to level {1}'),
    subsetMdxOriginal: vscode.l10n.t('Saved on the server:'),
    // Since the selection IS the base, this base is called what it is.
    vwBaseExplicit: vscode.l10n.t('selection ({0})'),
    // The search field says that it adds a LAYER — otherwise the user expects
    // the old meaning ("replace the list") and is puzzled by the trail.
    vwAliasTitle: vscode.l10n.t('Show elements under this alias — the search then matches it too'),
    // Checklist for attribute columns (task 6): ALL attributes, not just the
    // alias types -- unlike `vw-alias` above.
    vwAttrColsLabel: vscode.l10n.t('Attribute columns'),
    vwAttrColsButton: vscode.l10n.t('Attributes'),
    vwAttrColsButtonN: vscode.l10n.t('Attributes ({0})'),
    vwAttrColsTitle: vscode.l10n.t('Show attribute values as extra columns'),
    vwAttrColsNone: vscode.l10n.t('This hierarchy has no attributes.'),
    // Marker behind alias attributes in the checklist.
    vwAttrAliasTag: vscode.l10n.t('Alias'),
    // The two placeholder columns. They sit above the attributes in the same
    // checklist, but are not attributes themselves — see `attrColumns.ts#COL_INDEX`.
    vwColIndex: vscode.l10n.t('Index'),
    vwColWeight: vscode.l10n.t('Weight'),
    vwSortMenu: vscode.l10n.t('Sort\u2026'),
    vwSortNone: vscode.l10n.t('Remove sorting'),
    vwSortIndexAsc: vscode.l10n.t('Index, ASC'),
    vwSortIndexDesc: vscode.l10n.t('Index, DESC'),
    vwSortHierarchy: vscode.l10n.t('Tree order (HIERARCHIZE)'),
    vwSortHierAsc: vscode.l10n.t('In tree, ASC'),
    vwSortHierDesc: vscode.l10n.t('In tree, DESC'),
    vwSortAsc: vscode.l10n.t('Flat, BASC'),
    vwSortDesc: vscode.l10n.t('Flat, BDESC'),
    vwSortTitle: vscode.l10n.t('Sorts what is shown — by the alias when one is displayed. ASC/DESC keep children under their parents; BASC/BDESC break the hierarchy.'),
    vwLevelMenu: vscode.l10n.t('Level\u2026'),
    vwLevelAny: vscode.l10n.t('All levels'),
    vwLevelTitle: vscode.l10n.t('Keep only elements on this level'),
    vwTrailSortIndexAsc: vscode.l10n.t('index ASC'),
    vwTrailSortIndexDesc: vscode.l10n.t('index DESC'),
    vwTrailSortHier: vscode.l10n.t('HIERARCHIZE'),
    vwTrailSortHierAsc: vscode.l10n.t('{0} ASC'),
    vwTrailSortHierDesc: vscode.l10n.t('{0} DESC'),
    vwTrailSortAsc: vscode.l10n.t('{0} BASC'),
    vwTrailSortDesc: vscode.l10n.t('{0} BDESC'),
    vwSaveWindowIncomplete: vscode.l10n.t('Only part of this set is loaded. Tick "dynamic subset (MDX)" to save the whole set, or narrow it with filters first.'),
    vwSelectionWindowIncomplete: vscode.l10n.t('Only part of this set is loaded, and this caller cannot take an expression. Narrow the set with filters first.'),
    vwInsertWindowIncomplete: vscode.l10n.t('Inserting at a position needs the whole set loaded — narrow it with filters first.'),
    vwMoveTooManyRows: vscode.l10n.t('Moving rows works up to {0} rows — narrow the set with filters first.'),
    vwPasteNotFound: vscode.l10n.t('{0} name(s) not found: {1}'),
    vwApply: vscode.l10n.t('Apply'),
    vwMdxRunUnsupported: vscode.l10n.t('Running an edited expression is not available yet on this path — use the filter bars instead.'),
    vwApplyTitle: vscode.l10n.t('Add this filter as a layer and clear the field'),
    vwFilterPlaceholder: vscode.l10n.t('Search names (* ? wildcards)…'),
    vwFilterTitle: vscode.l10n.t('Type a name pattern, then Apply (or Enter)'),
    vwAttrNameTitle: vscode.l10n.t('Filter by an attribute value — adds a layer you can undo'),
    vwAttrValueTitle: vscode.l10n.t('Matches anywhere in the value, ignoring case — Apply (or Enter) to add the layer'),
    vwKeep: vscode.l10n.t('Keep'),
    vwKeepTitle: vscode.l10n.t('Keep only the marked elements'),
    vwRemove: vscode.l10n.t('Remove'),
    vwRemoveTitle: vscode.l10n.t('Remove the marked elements'),
    vwTrailCollapsed: vscode.l10n.t('collapsed {0}'),
    vwTrailExpanded: vscode.l10n.t('expanded {0}'),
    vwTrailExpandedFully: vscode.l10n.t('expanded {0} fully'),
    vwTrailAdded: vscode.l10n.t('added ({0})'),
    vwTrailParents: vscode.l10n.t('parents of {0}'),
    vwTrailParentPicked: vscode.l10n.t('parent {0}'),
    vwTrailKept: vscode.l10n.t('kept ({0})'),
    vwTrailRemoved: vscode.l10n.t('removed ({0})'),
    vwTrailPattern: vscode.l10n.t('Name {0}'),
    vwTrailPatternAttr: vscode.l10n.t('{0} {1}'),
    vwTrailType: vscode.l10n.t('Type {0}'),
    vwTrailLevel: vscode.l10n.t('Level {0}'),
    vwTrailAttr: vscode.l10n.t('{0} contains {1}'),
    vwTrailAttrAny: vscode.l10n.t('anything contains {0}'),
    vwTrailPendingTitle: vscode.l10n.t('Preview — not applied yet'),
    vwTrailPopTitle: vscode.l10n.t('Undo this layer'),
    vwNoDimBase: vscode.l10n.t('No dimension loaded — cannot switch the base.'),
    vwNoDim: vscode.l10n.t('No dimension loaded.'),
    vwNoDimFilter: vscode.l10n.t('No dimension loaded — cannot add a filter.'),
    vwNothingMarked: vscode.l10n.t('Nothing marked.'),
    vwTooManyMarks: vscode.l10n.t('Too many marks for one layer (max. {0}). Please do it in several steps.'),
    // The whole point of the message: DRILLUPMEMBER is positional, so it only
    // removes a block that directly follows its parent. In a dimension whose
    // elements were created before their consolidation, the click is a no-op —
    // which must be said, not swallowed.
    vwCollapseNoEffect: vscode.l10n.t('Collapsing removed nothing — the children of "{0}" do not follow it in this order.'),
    // Footer of the new path. N/C/S count the LOADED window only — a full type
    // breakdown would have to load the whole dimension.
    vwStatInWindow: vscode.l10n.t('in window'),
  };
}
