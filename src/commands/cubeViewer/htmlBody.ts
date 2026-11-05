import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/** Static body markup for the Cube Viewer webview. Icon URIs are injected per panel; text is pre-translated from the shared l10n map. */
export function getCubeViewerBody(webview: vscode.Webview, extensionUri: vscode.Uri, t: L10nMap): string {
  const u = (theme: 'light' | 'dark', name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'icons', theme, `${name}.svg`)).toString();

  const ic = (name: string) =>
    `<img class="btn-icon light-only" src="${u('light', name)}" alt=""><img class="btn-icon dark-only" src="${u('dark', name)}" alt="">`;

  return `
  <!-- Row 1: Action bar — view picker, reload-view, refresh, save, export, suppress -->
  <div class="action-bar">
    <label for="view-select" style="font-size:12px">${t.viewLabel}</label>
    <select id="view-select" title="${t.loadSavedView}">
      <option value="__none__">${t.ownSelection}</option>
    </select>
    <button id="btn-reload-view" class="btn-secondary icon-btn" type="button" disabled
      title="${t.reloadViewTitle}" aria-label="${t.reloadView}">${ic('refresh')}</button>
    <button id="btn-refresh" class="btn-secondary icon-btn">${ic('refresh')}${t.reload}</button>
    <button class="btn-secondary icon-btn" id="btn-save-view" title="${t.saveViewTitle}">${ic('save-view')}${t.saveView}</button>
    <button class="btn-secondary icon-btn" id="btn-export" style="display:none" title="${t.exportCsv}">${ic('csv')}${t.exportCsv}</button>
    <button class="btn-secondary icon-btn" id="btn-mdx" title="${t.mdxTitle}">${ic('mdx')}MDX</button>
    <span class="action-spacer"></span>
    <span class="cell-count" id="cell-count"></span>
    <div class="numfmt-group">
      <button id="btn-dec-sep" class="btn-secondary icon-btn toggle-btn" type="button" title="Decimal separator for display &amp; copy (point / comma)">${ic('decimal-separator')}<span class="dec-sep-state">1.0</span></button>
      <button id="btn-dec-less" class="btn-secondary icon-btn" type="button" title="Fewer decimals">${ic('decimals-less')}</button>
      <button id="btn-dec-more" class="btn-secondary icon-btn" type="button" title="More decimals">${ic('decimals-more')}</button>
      <button id="btn-dec-reset" class="btn-secondary icon-btn" type="button" hidden title="${t.fmtServer}: ${t.fmtServerTitle}" aria-label="${t.fmtServer}">${ic('reset-format')}</button>
    </div>
    <div class="suppress-group">
      <button id="chk-supp-cols" class="btn-secondary icon-btn toggle-btn" type="button" aria-pressed="false" title="${t.suppressColsTitle}">${ic('suppress-cols')}${t.suppressCols}</button>
      <button id="chk-supp-rows" class="btn-secondary icon-btn toggle-btn" type="button" aria-pressed="false" title="${t.suppressRowsTitle}">${ic('suppress-rows')}${t.suppressRows}</button>
      <button id="chk-auto-refresh" class="btn-secondary icon-btn toggle-btn" type="button" aria-pressed="false" title="${t.autoRefresh}">${ic('autorefresh')}${t.autoRefresh}</button>
    </div>
  </div>

  <!-- Row 2: Title zone — context dims with element selects -->
  <div class="title-zone" id="zone-titles" data-zone="titles">
    <span class="zone-label">${t.titles}</span>
  </div>

  <!-- Row 3: Axis bar — rows and columns zones; cols aligns with grid data-col start -->
  <div class="axis-bar">
    <div class="axis-zone axis-zone-rows" id="zone-rows" data-zone="rows">
      <span class="zone-label">${t.rows}</span>
    </div>
    <div class="zone-sep-swap">
      <button id="btn-swap-axes" class="btn-secondary icon-btn swap-axes-btn" type="button"
        title="${t.swapAxesTitle}" aria-label="${t.swapAxes}">${ic('swap-axes')}</button>
    </div>
    <div class="axis-zone axis-zone-cols" id="zone-cols" data-zone="cols">
      <span class="zone-label">${t.cols}</span>
    </div>
  </div>

  <div id="warn-banner"></div>
  <div id="error-banner"></div>
  <div id="loading" style="display:none"><div class="spinner"></div>${t.loading}</div>
  <div id="placeholder">${t.placeholder}</div>
  <div id="grid-container" style="display:none"></div>
  <!-- Bottom status bar: clicked cell's full-precision value, or count/sum/avg
       for a multi-cell selection. Always present (fixed height) so selecting a
       cell never resizes the grid. -->
  <div id="cell-value-pop" class="cell-value-bar"></div>

  <div id="ctx-menu">
    <div class="ctx-item" id="ctx-keep-only">${t.keepOnly}</div>
    <div class="ctx-item ctx-has-submenu" id="ctx-show-parents"><span class="ctx-label" id="ctx-show-parents-label">${t.showParents}</span><span class="ctx-submenu-arrow">▶</span><div class="ctx-submenu" id="ctx-show-parents-sub"></div></div>
    <div class="ctx-item" id="ctx-show-all-parents">${t.showAllParents}</div>
    <div class="ctx-item" id="ctx-expand-all">${t.expandAll}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-leaves">${t.leaves}</div>
    <div class="ctx-item" id="ctx-elem-plus-leaves">${t.elemPlusLeaves}</div>
    <div class="ctx-sep" id="ctx-sep-cell"></div>
    <div class="ctx-item" id="ctx-copy-name">${t.copyName}</div>
    <div class="ctx-item" id="ctx-copy-mdx">${t.copyMdx}</div>
    <div class="ctx-item" id="ctx-open-browser">${t.openDimension}</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" id="ctx-format">${t.fmtMenu}</div>
    <div class="ctx-item ctx-has-submenu ctx-multi" id="ctx-alias"><span class="ctx-label" id="ctx-alias-label">${t.aliasMenu}</span><span class="ctx-submenu-arrow">▶</span><div class="ctx-submenu" id="ctx-alias-sub"></div></div>
    <div class="ctx-sep"></div>
    <div class="ctx-item ctx-disabled" id="ctx-clear-filter">${t.clearFilter}</div>
  </div>

  <div id="ctx-spread-menu">
    <div class="ctx-item" data-method="proportional">${t.spreadProportional}</div>
    <div class="ctx-item" data-method="repeat">${t.spreadRepeat}</div>
    <div class="ctx-item" data-method="percentage">${t.spreadPercentage}</div>
    <div class="ctx-item" data-method="clear">${t.spreadClear}</div>
    <div class="ctx-sep" id="ctx-format-sep"></div>
    <div class="ctx-item" id="ctx-cell-format">${t.fmtMenu}</div>
    <div class="ctx-sep" id="ctx-trace-sep"></div>
    <div class="ctx-item" data-trace="rule">${t.traceRule}</div>
    <div class="ctx-item" data-trace="feeders">${t.traceFeeders}</div>
    <div class="ctx-item" data-trace="check">${t.traceCheckFeeders}</div>
  </div>

  <div class="modal-overlay" id="spread-prompt-overlay">
    <div class="modal-box">
      <h3 id="spread-prompt-title">${t.spread}</h3>
      <label for="spread-prompt-input" id="spread-prompt-label">${t.spreadValueLabel}</label>
      <input type="text" id="spread-prompt-input" inputmode="decimal" autocomplete="off" />
      <div id="spread-prompt-error" class="modal-error" style="display:none;"></div>
      <div class="modal-actions">
        <button type="button" id="spread-prompt-cancel">${t.cancel}</button>
        <button type="button" id="spread-prompt-ok" class="primary">OK</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="mdx-modal">
    <div class="modal-box mdx-modal-box">
      <h3>MDX</h3>
      <div id="mdx-editor" class="mdx-editor-mount"></div>
      <textarea id="mdx-text" spellcheck="false" hidden></textarea>
      <div class="modal-actions">
        <button id="mdx-format-btn">${t.format}</button>
        <button id="mdx-copy-btn">${t.copy}</button>
        <button id="mdx-open-runner-btn">${t.openInMdxRunner}</button>
        <button id="mdx-save-btn">${t.saveMdxView}</button>
        <button id="mdx-run-btn" class="primary">${t.run}</button>
        <button id="mdx-close-btn">${t.close}</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="fmt-modal">
    <div class="modal-box fmt-box">
      <h3 id="fmt-title"></h3>
      <div class="modal-row" id="fmt-dim-row" hidden>
        <label for="fmt-dim">${t.fmtApplyTo}</label>
        <select id="fmt-dim"></select>
      </div>
      <div class="fmt-grid">
        <label for="fmt-decimals">${t.fmtDecimals}</label><input type="number" id="fmt-decimals" min="0" step="1">
        <label for="fmt-group">${t.fmtGroup}</label><input type="checkbox" id="fmt-group">
        <label for="fmt-negative">${t.fmtNegative}</label>
        <select id="fmt-negative"><option value="minus">-1.234</option><option value="parens">(1.234)</option></select>
        <label for="fmt-zero">${t.fmtZero}</label>
        <select id="fmt-zero"><option value="zero">0</option><option value="blank">${t.fmtZeroBlank}</option><option value="dash">–</option></select>
        <label for="fmt-unit">${t.fmtUnit}</label><input type="text" id="fmt-unit" autocomplete="off" spellcheck="false" placeholder="€, Stk, …">
        <label for="fmt-scale">${t.fmtScale}</label>
        <select id="fmt-scale" title="${t.fmtScaleTitle}"><option value="none">${t.fmtScaleNone}</option><option value="k">${t.fmtScaleK}</option><option value="m">${t.fmtScaleM}</option></select>
        <label for="fmt-percent">${t.fmtPercent}</label><input type="checkbox" id="fmt-percent">
      </div>
      <div class="modal-row">
        <label for="fmt-pattern">${t.fmtPattern}</label>
        <input type="text" id="fmt-pattern" autocomplete="off" spellcheck="false">
      </div>
      <div class="fmt-recent" id="fmt-recent" hidden></div>
      <div class="modal-error" id="fmt-msg"></div>
      <table class="fmt-preview"><thead><tr><th>${t.fmtRaw}</th><th>${t.fmtShown}</th></tr></thead><tbody id="fmt-preview"></tbody></table>
      <div class="fmt-note" id="fmt-display-note">${t.fmtDisplayOnly}</div>
      <div class="fmt-note" id="fmt-server"></div>
      <div class="modal-actions">
        <button type="button" id="fmt-to-server" title="${t.fmtToServerTitle}">${t.fmtToServer}</button>
        <button type="button" id="fmt-reset">${t.fmtReset}</button>
        <button type="button" id="fmt-cancel">${t.cancel}</button>
        <button type="button" id="fmt-apply" class="primary">${t.fmtApply}</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="view-save-modal">
    <div class="modal-box">
      <h3>${t.saveViewHeading}</h3>
      <div class="modal-row">
        <label for="view-save-name">${t.name}</label>
        <input type="text" id="view-save-name" autocomplete="off" spellcheck="false">
      </div>
      <div class="modal-row modal-radios">
        <label><input type="radio" name="view-save-priv" value="private" checked> ${t.privatePrivate}</label>
        <label><input type="radio" name="view-save-priv" value="public"> ${t.public}</label>
      </div>
      <div class="modal-row modal-checkbox">
        <label><input type="checkbox" id="view-save-overwrite"> ${t.overwriteExisting}</label>
      </div>
      <div class="modal-row modal-checkbox">
        <label><input type="checkbox" id="view-save-as-mdx" title="${t.saveAsMdxTitle}"> ${t.saveAsMdx}</label>
      </div>
      <div class="modal-row modal-checkbox" id="view-save-formats-row" hidden>
        <label><input type="checkbox" id="view-save-formats" checked title="${t.fmtSaveTitle}"> ${t.fmtSave}</label>
        <div class="fmt-note" id="view-save-formats-note"></div>
      </div>
      <div class="modal-msg" id="view-save-msg"></div>
      <div class="modal-actions">
        <button id="view-save-cancel-btn">${t.cancel}</button>
        <button id="view-save-do-btn" class="primary">${t.save}</button>
      </div>
    </div>
  </div>
`;
}
