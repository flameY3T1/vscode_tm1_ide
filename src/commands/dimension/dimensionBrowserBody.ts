/**
 * HTML body markup of the TM1 Dimension Browser webview. Static — all dynamic
 * data is loaded via postMessage after the panel opens (see `dimensionBrowser.ts`).
 *
 * Rendered server-side from the shared l10n map (`buildDimensionBrowserL10n`) so
 * all text is pre-translated; the shell in `dimensionBrowserWebview.ts` stays
 * focused on assembling CSP + script URI + bundle references.
 */
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/**
 * Renders one explorer glyph as a light/dark `<img>` pair — supply
 * `makeIconRenderer(webview, extensionUri)` from `webviews/webviewIcons`. Passed
 * in rather than built here so this module stays free of `vscode`.
 */
export type BodyIconRenderer = (name: string) => string;

/** No-op renderer for callers without a webview handle (pure unit tests). */
const NO_ICON: BodyIconRenderer = () => '';

export function buildDimensionBrowserBody(t: L10nMap, ic: BodyIconRenderer = NO_ICON): string {
  return `
  <div class="controls-bar">
    <label id="hier-label">${t.hierarchyLabel}</label>
    <select id="hier-select"><option value="">—</option></select>
    <label id="subset-label">${t.subsetLabel}</label>
    <select id="subset-select" title="${t.subsetSelectTitle}">
      <option value="__all__">${t.optAll}</option>
      <option value="__nlevel__">${t.optNLevel}</option>
      <option value="__toplevel__">${t.optTopLevel}</option>
    </select>
    <button id="refresh-btn" title="${t.refreshTitle}">&#8635;</button>
    <!-- Attribute columns (Task 6): a checkbox list instead of select-multiple
         (a list box instead of a dropdown, does not fit into a toolbar).
         Takes effect on closing, see viewControls.ts#attrColsClose.

         Since the click test on 2026-08-25 it sits HERE instead of in the filter bar:
         choosing columns is not filtering — it changes what is visible of a row,
         not WHICH rows are shown. The container needs
         position: relative because the menu hangs absolutely below the button. -->
    <span class="vw-attrcols-wrap">
      <button id="vw-attrcols-btn" style="display:none" title="${t.vwAttrColsTitle}"
              aria-haspopup="true" aria-expanded="false">${t.vwAttrColsButton}</button>
      <div id="vw-attrcols-menu" class="vw-attrcols-menu" style="display:none" role="group"
           aria-label="${t.vwAttrColsLabel}"></div>
    </span>
    <div class="controls-right">
      <button id="open-attr-cube-btn" title="${t.attrCubeTitle}" disabled>${ic('attributes-cube')}${t.attrCube}</button>
      <button id="open-dim-editor-btn" title="${t.dimEditorTitle}">${ic('dimension-editor-tree')}${t.dimEditor}</button>
      <button id="mdx-btn" title="${t.mdxTitle}">${ic('mdx')}MDX</button>
      <button id="save-subset-btn" title="${t.saveSubsetTitle}">${ic('save-subset')}${t.saveSubsetBtn}</button>
    </div>
  </div>
  <div class="search-bar" id="search-bar">
    <input id="filter-input" type="text" placeholder="&#128269; ${t.filterPlaceholder}">
    <!-- The search field of the NEW loading path. In the SAME place as the old one, with
         its own id: the search should stand where it always stood, but
         a field whose meaning depends on a switch cost two fix rounds in the click test
         of Plan 3. -->
    <input id="vw-filter-input" type="text" style="display:none" placeholder="&#128269; ${t.vwFilterPlaceholder}" title="${t.vwFilterTitle}">
    <button id="vw-filter-apply" style="display:none" title="${t.vwApplyTitle}">${t.vwApply}</button>
  </div>
  <div class="filter-bar" id="filter-bar">
    <label for="alias-select" id="alias-label">${t.displayLabel}</label>
    <select id="alias-select" title="${t.aliasSelectTitle}"><option value="">${t.optName}</option></select>
    <!-- The display selection of the NEW loading path. No Apply button: the alias
         is not a layer, it changes the labels of the rows and not
         their selection. -->
    <label for="vw-alias" id="vw-alias-label" style="display:none">${t.displayLabel}</label>
    <select id="vw-alias" style="display:none" title="${t.vwAliasTitle}"><option value="">${t.optName}</option></select>
    <label for="sort-mode" id="sort-label">${t.sortLabel}</label>
    <select id="sort-mode" title="${t.sortSelectTitle}">
      <option value="none" selected>${t.sortNone}</option>
      <option value="hierarchy">${t.sortHierarchy}</option>
      <option value="name-asc">${t.sortNameAsc}</option>
      <option value="name-desc">${t.sortNameDesc}</option>
      <option value="index-asc">${t.sortIndexAsc}</option>
      <option value="index-desc">${t.sortIndexDesc}</option>
    </select>
    <label for="level-filter" id="level-label">${t.levelLabel}</label>
    <select id="level-filter" multiple title="${t.levelFilterTitle}"></select>
    <label for="attr-name-filter" id="attr-name-label">${t.attributeLabel}</label>
    <select id="attr-name-filter"><option value="">${t.optNone}</option></select>
    <input id="attr-val-filter" type="text" placeholder="${t.valueContainsPlaceholder}">
    <!-- The attribute fields of the NEW loading path. The label carries its
         own id because it has to disappear together with its fields: a
         for reference to a hidden field is a label without a thing.
         (No backticks in this comment - it sits inside a
         template literal and would end it.) -->
    <label for="vw-attr-name" id="vw-attr-label" style="display:none">${t.attributeLabel}</label>
    <select id="vw-attr-name" style="display:none" title="${t.vwAttrNameTitle}"><option value="">${t.optNone}</option></select>
    <input id="vw-attr-value" type="text" style="display:none" placeholder="${t.valueContainsPlaceholder}" title="${t.vwAttrValueTitle}">
    <button id="vw-attr-apply" style="display:none" title="${t.vwApplyTitle}">${t.vwApply}</button>
    <button class="quick-toggle icon-only" id="quick-only-n" title="${t.quickOnlyNTitle}" aria-label="${t.quickOnlyN}">${ic('only-n-elements')}</button>
    <button class="quick-toggle icon-only" id="quick-only-c" title="${t.quickOnlyCTitle}" aria-label="${t.quickOnlyC}">${ic('only-c-elements')}</button>
    <button class="quick-toggle icon-only" id="quick-only-s" title="${t.quickOnlySTitle}" aria-label="${t.quickOnlyS}">${ic('only-s-elements')}</button>
  </div>
  <!-- A row of its own: in the list state the selection actions are the primary
       controls and should not stand between the filters, which have no effect there.
       Drill deliberately does NOT sit here — the actions hang off the context menu of the
       clicked row, where the reference to the row is unambiguous anyway. -->
  <div class="mark-bar" id="mark-actions">
    <button id="btn-show-all" title="${t.showAllTitle}">${t.showAll}</button>
    <button id="btn-keep-marked" disabled>${t.keepMarked}</button>
    <button id="btn-remove-marked" disabled>${t.removeMarked}</button>
    <span id="mark-count"></span>
    <!-- The button row of the NEW loading path. Its own ids, not the old ones
         reinterpreted: \`btn-show-all\` means „Alle anzeigen" (show all, i.e. reset),
         \`vw-btn-base-all\` means "the basis is TM1SUBSETALL". Same word,
         different deed — a button whose meaning depends on a switch cost
         two fix rounds in the click test of Plan 3.
         The label of the basis button is the SAME string as the one
         of the trail (\`vwBaseMembers\`/\`vwBaseAll\`) — one thing, one name. -->
    <button id="vw-btn-base-members" style="display:none" title="${t.vwBaseMembersTitle}">${t.vwBaseMembers}</button>
    <button id="vw-btn-base-all" style="display:none" title="${t.vwBaseAllTitle}">${t.vwBaseAll}</button>
    <button id="vw-btn-keep" style="display:none" disabled title="${t.vwKeepTitle}">${t.vwKeep}</button>
    <button id="vw-btn-remove" style="display:none" disabled title="${t.vwRemoveTitle}">${t.vwRemove}</button>
    <button id="vw-quick-n" style="display:none" title="${t.quickOnlyNTitle}" aria-label="${t.quickOnlyNTitle}">N</button>
    <button id="vw-quick-c" style="display:none" title="${t.quickOnlyCTitle}" aria-label="${t.quickOnlyCTitle}">C</button>
    <button id="vw-quick-s" style="display:none" title="${t.quickOnlySTitle}" aria-label="${t.quickOnlySTitle}">S</button>
    <!-- Sorting and level stand in THIS row, not in the filter bar
         above it (UX decision, 2026-08-23): they are select fields and
         take effect immediately, while the bar above carries fields that one
         types into and confirms. Two modes of operation in one row would mean
         sometimes needing the Apply button and sometimes not. -->
    <select id="vw-sort" style="display:none" title="${t.vwSortTitle}">
      <option value="">${t.vwSortMenu}</option>
      <option value="hier-asc">${t.vwSortHierAsc}</option>
      <option value="hier-desc">${t.vwSortHierDesc}</option>
      <option value="asc">${t.vwSortAsc}</option>
      <option value="desc">${t.vwSortDesc}</option>
      <option value="index-asc">${t.vwSortIndexAsc}</option>
      <option value="index-desc">${t.vwSortIndexDesc}</option>
      <option value="hierarchy">${t.vwSortHierarchy}</option>
      <option value="none">${t.vwSortNone}</option>
    </select>
    <select id="vw-level" style="display:none" title="${t.vwLevelTitle}">
      <option value="">${t.vwLevelMenu}</option>
      <option value="-">${t.vwLevelAny}</option>
    </select>
    <span id="vw-mark-count" style="display:none"></span>
  </div>
  <div id="error-banner"></div>
  <div id="loading"><div class="spinner"></div>&nbsp;${t.loading}</div>
  <div id="placeholder">${t.placeholder}</div>
  <div id="pane-single">
    <div class="pane-header">
      <!-- The label is gone (UX decision, 2026-08-23): it
           said nothing that the list below does not show by itself. The bar
           stays as a separator, and the mode note next to it keeps
           its place. -->
      <span class="pane-mode" id="pane-mode-tag" style="display:none">${t.paneManualOrder}</span>
    </div>
    <div id="subset-mdx-bar" style="display:none" title="">
      ${ic('subset-dynamic-bolt')}
      <span class="subset-mdx-tag" id="subset-mdx-tag">${t.subsetDynamicTag}</span>
      <span class="subset-mdx-changed" id="subset-mdx-changed" style="display:none">${t.subsetMdxChangedTag}</span>
      <code id="subset-mdx-text"></code>
    </div>
    <div id="vw-trail" class="vw-trail" style="display:none"></div>
    <div id="table-container">
      <table class="dim-table" id="dim-table" role="treegrid">
        <colgroup id="table-cols"><col></colgroup>
        <thead id="table-head" role="rowgroup"></thead>
        <tbody id="table-body" role="rowgroup"></tbody>
      </table>
    </div>
  </div>
  <div id="selection-footer">
    <span id="sel-count">0</span>
    <button id="btn-confirm">&#10003; ${t.confirm}</button>
  </div>

  <div id="ctx-menu">
    <div class="ctx-item" id="ctx-only-this">${t.ctxOnlyThis}</div>
    <div class="ctx-item ctx-has-submenu" id="ctx-show-parents">${t.ctxShowParents}<span class="ctx-submenu-arrow">&#9654;</span><div class="ctx-submenu" id="ctx-show-parents-sub"></div></div>
    <div class="ctx-item" id="ctx-show-all-parents">${t.ctxShowAllParents}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-leaves" title="${t.ctxLeavesTitle}">${t.ctxLeaves}</div>
    <div class="ctx-item" id="ctx-elem-plus-leaves" title="${t.ctxElemPlusLeavesTitle}">${t.ctxElemPlusLeaves}</div>
    <div class="ctx-item" id="ctx-insert-above" title="${t.ctxInsertAboveTitle}">${t.ctxInsertAbove}</div>
    <div class="ctx-item" id="ctx-insert-below" title="${t.ctxInsertBelowTitle}">${t.ctxInsertBelow}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-expand-all">${t.ctxExpandAll}</div>
    <div class="ctx-item ctx-has-submenu" id="ctx-expand-to-level" title="${t.ctxExpandToLevelTitle}">${t.ctxExpandToLevel}<span class="ctx-submenu-arrow">&#9654;</span><div class="ctx-submenu" id="ctx-expand-to-level-sub"></div></div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-clear-all">${t.ctxClearAll}</div>
    <div class="ctx-item" id="ctx-collapse-all">${t.ctxCollapseAll}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-copy-name">${t.ctxCopyName}</div>
    <div class="ctx-item" id="ctx-copy-mdx">${t.ctxCopyMdx}</div>
  </div>

  <div id="status-footer">
    <span class="stat" id="stat-visible"><strong id="stat-visible-n">0</strong><span id="stat-visible-t">${t.statVisible}</span></span>
    <span class="sep"></span>
    <span class="stat" id="stat-total"><strong id="stat-total-n">0</strong><span id="stat-total-t">${t.statTotal}</span></span>
    <span class="sep"></span>
    <span class="stat" id="stat-n"><strong id="stat-n-n">0</strong><span id="stat-n-t">N</span></span>
    <span class="stat" id="stat-c"><strong id="stat-c-n">0</strong><span id="stat-c-t">C</span></span>
    <span class="stat" id="stat-s"><strong id="stat-s-n">0</strong><span id="stat-s-t">S</span></span>
  </div>

  <div class="modal-overlay" id="mdx-modal">
    <div class="modal-box mdx-modal-box">
      <h3>${t.mdxSubset}</h3>
      <div id="mdx-editor" class="mdx-editor-mount"></div>
      <textarea id="mdx-text" spellcheck="false" hidden></textarea>
      <div class="modal-actions">
        <button id="mdx-format-btn">${t.mdxFormat}</button>
        <button id="mdx-copy-btn">${t.mdxCopy}</button>
        <button id="mdx-open-runner-btn">${t.mdxOpenRunner}</button>
        <button id="mdx-run-btn" class="primary">${t.mdxRun}</button>
        <button id="mdx-close-btn">${t.mdxClose}</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="save-modal">
    <div class="modal-box">
      <h3>${t.saveSubsetTitleModal}</h3>
      <div class="modal-row">
        <label for="save-name">${t.nameLabel}</label>
        <input type="text" id="save-name" autocomplete="off" spellcheck="false">
      </div>
      <div class="modal-row modal-radios">
        <label><input type="radio" name="save-priv" value="private" checked> ${t.savePrivate}</label>
        <label><input type="radio" name="save-priv" value="public"> ${t.savePublic}</label>
      </div>
      <div class="modal-row modal-checkbox">
        <label><input type="checkbox" id="save-overwrite"> ${t.saveOverwrite}</label>
      </div>
      <!-- Dynamic (MDX) save: enabled + preselected only when the current
           selection can actually be described by an expression; the hint below
           says why when it cannot. Preview shows the MDX that would be stored. -->
      <div class="modal-row modal-checkbox">
        <label><input type="checkbox" id="save-dynamic"> ${t.saveDynamic}</label>
      </div>
      <div class="modal-hint" id="save-dynamic-hint"></div>
      <div class="modal-mdx-preview" id="save-dynamic-preview"><code id="save-dynamic-mdx"></code></div>
      <div class="modal-msg" id="save-msg"></div>
      <div class="modal-actions">
        <button id="save-cancel-btn">${t.cancel}</button>
        <button id="save-do-btn" class="primary">${t.save}</button>
      </div>
    </div>
  </div>
`;
}
