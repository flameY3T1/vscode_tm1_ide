/**
 * HTML body markup TM1 Chore Editor webview. Static — all dynamic
 * data loaded via postMessage panel opens (see `choreEditor.ts`).
 *
 * Rendered server-side from the shared l10n map (`buildChoreEditorL10n`) so all
 * static text is pre-translated (no FOUC). The shell in `choreEditorWebview.ts`
 * stays focused on assembling CSP + script URI + bundle reference.
 */
import type { L10nMap } from '../../webviewClient/_shared/l10n';
import { escapeHtml as esc } from '../../utils/escapeHtml';

export function buildChoreEditorBody(t: L10nMap): string {
  return `
<div id="loading">${esc(t.loading)}</div>

<div id="main">
  <div class="toolbar">
    <span class="toolbar-title" id="toolbar-title">${esc(t.toolbarTitle)}</span>
    <div id="validation-banner" class="validation-error"></div>
    <button id="btn-save">${esc(t.save)}</button>
    <button id="btn-save-as" title="${esc(t.saveAsTitle)}">${esc(t.saveAs)}</button>
    <button id="btn-run" title="${esc(t.runTitle)}">${esc(t.saveAndRun)}</button>
    <button id="btn-cancel" class="secondary">${esc(t.cancel)}</button>
  </div>

  <div class="editor-body">
    <!-- Properties -->
    <div class="section">
      <div class="section-header">${esc(t.properties)}</div>
      <div class="section-body">
        <div class="field-row">
          <span class="field-label">${esc(t.name)}</span>
          <input type="text" id="f-name" style="width:300px" placeholder="${esc(t.namePlaceholder)}" />
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="f-active" />
          <label for="f-active">${esc(t.active)}</label>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="f-dst" />
          <label for="f-dst">${esc(t.dst)}</label>
        </div>
        <div class="field-row">
          <span class="field-label">${esc(t.executionMode)}</span>
          <select id="f-execmode">
            <option value="MultipleCommit">${esc(t.multipleCommit)}</option>
            <option value="SingleCommit">${esc(t.singleCommit)}</option>
          </select>
        </div>
        <div class="field-row">
          <span class="field-label">${esc(t.startTime)}</span>
          <input type="date" id="f-date" title="${esc(t.dateTitle)}" style="margin-right:8px;" />
          <div class="time-inputs">
            <input type="text" inputmode="numeric" id="f-hour" maxlength="2" value="00" title="${esc(t.hourTitle)}" style="width:36px;text-align:center;" />
            <span class="time-sep">:</span>
            <input type="text" inputmode="numeric" id="f-minute" maxlength="2" value="00" title="${esc(t.minuteTitle)}" style="width:36px;text-align:center;" />
          </div>
          <span style="font-size:11px;color:var(--vscode-descriptionForeground);margin-left:6px;">${esc(t.timeZoneHint)}</span>
        </div>
        <div class="field-row">
          <span class="field-label">${esc(t.frequency)}</span>
          <select id="f-freq">
            <option value="P0DT00H15M00S">${esc(t.freq15min)}</option>
            <option value="P0DT00H30M00S">${esc(t.freq30min)}</option>
            <option value="P0DT01H00M00S">${esc(t.freqHourly)}</option>
            <option value="P0DT02H00M00S">${esc(t.freq2h)}</option>
            <option value="P0DT04H00M00S">${esc(t.freq4h)}</option>
            <option value="P0DT06H00M00S">${esc(t.freq6h)}</option>
            <option value="P0DT12H00M00S">${esc(t.freq12h)}</option>
            <option value="P1DT00H00M00S" selected>${esc(t.freqDaily)}</option>
            <option value="P7DT00H00M00S">${esc(t.freqWeekly)}</option>
            <option value="days">${esc(t.freqNDays)}</option>
          </select>
          <span id="f-freq-days-wrap" style="display:none;margin-left:8px;align-items:center;gap:4px;">
            <input type="text" inputmode="numeric" id="f-freq-days" maxlength="3" value="30" style="width:48px;text-align:center;" title="${esc(t.nDaysTitle)}" />
            <span style="font-size:12px;">${esc(t.days)}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Tasks -->
    <div class="section">
      <div class="section-header">${esc(t.tasks)}</div>
      <div class="section-body">
        <div id="tasks-container"></div>
        <button id="btn-add-task">${esc(t.addTask)}</button>
      </div>
    </div>
  </div>
</div>
`;
}
