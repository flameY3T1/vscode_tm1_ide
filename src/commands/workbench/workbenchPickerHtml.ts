import type { CandidateWindow } from './collectWindows';
import { MAX_WINDOWS } from './workbenchStorePure';
import type { PickerConfig } from '../../webviewClient/workbenchPicker/protocol';
import { escapeHtml as esc } from '../../utils/escapeHtml';

export interface PickerLabels {
  name: string; save: string; cancel: string; other: string; counter: string;
  /** Visible label of the name field — not just a placeholder. */
  nameLabel: string;
  /** Caption of the save button, once the name is already taken. */
  overwrite: string;
  all: string; none: string;
  existing: string; server: string;
  /** Note on an entry that is in the workbench but not open. */
  notOpen: string;
  /** Heading in edit mode. */
  editing: string;
}

/**
 * What is being saved for.
 *
 * The server appeared nowhere in the window; anyone with two connections
 * open had to infer it from the window title. And the name conflict only
 * showed up AFTER the click, as a modal dialog — even though the existing
 * names have long been known.
 */
export interface PickerContext {
  serverName: string;
  existingNames: string[];
  /**
   * Set when an existing workbench is being edited.
   *
   * The name is then pre-filled and its own name does NOT trigger a
   * conflict — after all, it is precisely this one being edited.
   */
  editingName?: string;
}

/**
 * Body of the selection window. Pure — no `vscode`, so the grouping and
 * the escaping can be tested without an open panel.
 */
export function renderWorkbenchPickerBody(
  cands: CandidateWindow[], labels: PickerLabels, ctx: PickerContext,
): string {
  const groups = new Map<string, CandidateWindow[]>();
  for (const c of cands) {
    const g = c.group || labels.other;
    const list = groups.get(g) ?? [];
    list.push(c);
    groups.set(g, list);
  }
  const sections = [...groups.entries()].map(([group, list], gi) => [
    `<section data-group="g${gi}">`,
    `<h3><span class="wbgname">${esc(group)}</span>`,
    `<span class="wbgcount">${list.length}</span>`,
    `<span class="wbgacts">`,
    `<button type="button" class="linkish" data-group-all="g${gi}">${esc(labels.all)}</button>`,
    `<button type="button" class="linkish" data-group-none="g${gi}">${esc(labels.none)}</button>`,
    `</span></h3><ul>`,
    ...list.map(c => [
      `<li><label><input type="checkbox" value="${esc(c.id)}"${c.checked ? ' checked' : ''}>`,
      `<span class="wl">${esc(c.label)}</span>`,
      c.description ? `<span class="wd">${esc(c.description)}</span>` : '',
      // An entry that only exists in the workbench: its state is the one
      // from back then and stays that way, because there is no one left
      // to ask.
      c.open ? '' : `<span class="wclosed">${esc(labels.notOpen)}</span>`,
      '</label></li>',
    ].join('')),
    '</ul></section>',
  ].join('')).join('');

  // The existing names appear both visibly AND in the config block:
  // visibly, so a free name can be chosen; in the block, so the script can
  // switch to "overwrite" while typing.
  const existing = ctx.existingNames.length
    ? [
      `<div id="wbexisting"><span class="wbexlabel">${esc(labels.existing)}</span>`,
      ctx.existingNames.map(n => `<span class="wbex">${esc(n)}</span>`).join(''),
      '</div>',
    ].join('')
    : '';

  const cfg: PickerConfig = {
    max: MAX_WINDOWS,
    counter: labels.counter,
    // Its own name is not a conflict with itself.
    existing: ctx.existingNames.filter(n => n !== ctx.editingName),
    save: labels.save,
    overwrite: labels.overwrite,
    name: ctx.editingName ?? '',
  };

  return [
    '<header>',
    `<div id="wbserver"><span class="wbslabel">${esc(ctx.editingName ? labels.editing : labels.server)}</span>`,
    `<span class="wbsname">${esc(ctx.editingName ?? ctx.serverName)}</span></div>`,
    `<div class="wbnamerow"><label for="wbname">${esc(labels.nameLabel)}</label>`,
    `<input id="wbname" type="text" placeholder="${esc(labels.name)}" `
      + `value="${esc(ctx.editingName ?? '')}" autofocus></div>`,
    existing,
    '</header>',
    `<div id="wblist">${sections}</div>`,
    `<footer><span id="wbcount"></span>`,
    `<button id="wbcancel" class="secondary">${esc(labels.cancel)}</button>`,
    `<button id="wbsave" class="primary">${esc(labels.save)}</button></footer>`,
    `<script type="application/json" id="wbcfg">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`,
  ].join('');
}

/**
 * Appearance of the selection window.
 *
 * Lives here instead of in `saveFlow.ts` because it is part of the visual
 * appearance and should be just as testable as the markup: the save
 * button previously carried NOT A SINGLE theme token (only `cursor:
 * pointer`) and thus fell back to the browser default — white on light,
 * unreadable in dark themes. The shapes come from `cubeViewer/css.ts`, so
 * windows of the same extension do not look different from each other.
 */
export const WORKBENCH_PICKER_CSS = `
  body { padding: 10px 14px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }

  header { margin-bottom: 12px; }
  #wbserver { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; }
  .wbslabel { opacity: .6; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .wbsname { font-weight: 600; }

  .wbnamerow { display: flex; align-items: center; gap: 8px; }
  .wbnamerow label { opacity: .8; }
  #wbname { flex: 0 1 320px; max-width: 320px; padding: 4px 6px; border-radius: 3px;
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
            font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  #wbname:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  #wbname.clash { border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground)); }

  #wbexisting { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin-top: 8px; }
  .wbexlabel { opacity: .6; font-size: 11px; }
  .wbex { padding: 1px 6px; border-radius: 8px; font-size: 11px;
          background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }

  h3 { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px;
       font-size: 12px; font-weight: 600; }
  .wbgname { opacity: .8; }
  .wbgcount { padding: 0 6px; border-radius: 8px; font-size: 11px; font-variant-numeric: tabular-nums;
              background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .wbgacts { margin-left: auto; display: flex; gap: 4px; }

  ul { list-style: none; margin: 0; padding: 0; }
  li label { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; cursor: pointer; }
  .wl { flex: 0 0 auto; }
  .wd { opacity: .6; }
  .wclosed { opacity: .55; font-size: 11px; font-style: italic; }

  footer { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  #wbcount { flex: 1; opacity: .7; font-variant-numeric: tabular-nums; }

  button { padding: 4px 11px; border-radius: 3px; border: none; cursor: pointer;
           font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
           line-height: 1.3; white-space: nowrap;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: .4; cursor: default; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

  /* The group toggles are text, not buttons — they should not weigh the row
     down, but they still need a color from the theme. */
  button.linkish { background: transparent; color: var(--vscode-textLink-foreground);
                   padding: 0 2px; font-size: 11px; }
  button.linkish:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
`;
