/**
 * Toolbar buttons + tab clicks + keyboard shortcuts.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import * as monaco from 'monaco-editor';
import { editor, sharedState, vscode, SectionKey } from './state';
import { switchToSection, currentSections } from './sections';
import { buildSavePayload } from './save';
import { formatAllSections } from './format';
import { requestResolver } from './lint';
import { markResolverPending } from './resolver';
import { getParameters } from './parameters';
import { getDataSource } from './dataSource';
import { getVariables } from './variables';
import { getBreakpoints } from './breakpoints';
import { isDebugging, isDebugPaused, requestDebugStart, sendDebugCommand } from './debug';
import { initFormatMenu } from './formatMenu';
import { initEditMenu } from '../_shared/editMenu';
import { initLintMenu } from './lintMenu';
import { getL10n } from '../_shared/l10n';

export {};

const L = getL10n();

export function initToolbar(): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', () => {
      const tabName = tabEl.dataset.tab;
      if (!tabName) { return; }
      const section = tabEl.dataset.section as SectionKey | undefined;
      if (tabName === 'code' && section) {
        switchToSection(section);
        return;
      }
      document.querySelectorAll<HTMLElement>('.tab').forEach(t => t.classList.toggle('active', t === tabEl));
      document.querySelectorAll<HTMLElement>('.panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${tabName}`);
      });
      if (tabName === 'resolver') {
        sharedState.resolverTabActive = true;
        markResolverPending();
        requestResolver();
      } else {
        sharedState.resolverTabActive = false;
      }
    });
  });

  document.getElementById('btn-save')?.addEventListener('click', () => {
    vscode.postMessage(buildSavePayload('save'));
  });
  document.getElementById('btn-save-as')?.addEventListener('click', () => {
    vscode.postMessage(buildSavePayload('saveAs'));
  });
  document.getElementById('btn-execute')?.addEventListener('click', () => {
    vscode.postMessage(buildSavePayload('execute'));
  });
  // btn-format now opens the formatter dropdown (initFormatMenu); "Apply now"
  // inside the menu runs the format. The Ctrl+Shift+I command below still
  // formats directly.

  document.getElementById('btn-debug')?.addEventListener('click', () => {
    const statusEl = document.getElementById('debug-status');
    if (statusEl) { statusEl.textContent = L.dbgStarting; statusEl.classList.remove('has-error'); }
    requestDebugStart(getParameters(), getBreakpoints(), {
      sections: currentSections(),
      dataSource: getDataSource(),
      variables: getVariables(),
    });
  });
  document.getElementById('btn-debug-continue')?.addEventListener('click',  () => sendDebugCommand('continue'));
  document.getElementById('btn-debug-step-over')?.addEventListener('click', () => sendDebugCommand('stepOver'));
  document.getElementById('btn-debug-step-in')?.addEventListener('click',   () => sendDebugCommand('stepIn'));
  document.getElementById('btn-debug-step-out')?.addEventListener('click',  () => sendDebugCommand('stepOut'));
  document.getElementById('btn-debug-stop')?.addEventListener('click',      () => sendDebugCommand('stop'));

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    vscode.postMessage(buildSavePayload('save'));
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => {
    vscode.postMessage(buildSavePayload('saveAs'));
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, formatAllSections);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
    void editor.getAction('editor.action.commentLine')?.run();
  });
  // Ctrl+# on a German keyboard (the `#` key sits at the US-backslash position).
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => {
    void editor.getAction('editor.action.commentLine')?.run();
  });

  editor.addCommand(monaco.KeyCode.F5, () => {
    // F5: continue when paused, otherwise start debugging (like VS Code).
    if (isDebugPaused()) { sendDebugCommand('continue'); return; }
    // Same reason as Ctrl+F5 below: `body.loading` only blocks pointer
    // events, a synthetic .click() would start a second debug session.
    if (document.body.classList.contains('loading')) { return; }
    const b = document.getElementById('btn-debug');
    if (b && b.offsetParent !== null) { (b as HTMLElement).click(); }
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F5, () => {
    // Ctrl+F5: run without debugging (like VS Code). Skip while a run is in
    // flight — `body.executing` only sets `pointer-events:none` on the button
    // (not display:none), so a synthetic .click() would bypass it and double-run
    // the TI process on the live server.
    if (document.body.classList.contains('executing')) { return; }
    const b = document.getElementById('btn-execute');
    if (b && b.offsetParent !== null) { (b as HTMLElement).click(); }
  });
  editor.addCommand(monaco.KeyCode.F10, () => {
    if (isDebugPaused()) { sendDebugCommand('stepOver'); }
  });
  editor.addCommand(monaco.KeyCode.F11, () => {
    if (isDebugPaused()) { sendDebugCommand('stepIn'); }
  });
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F11, () => {
    if (isDebugPaused()) { sendDebugCommand('stepOut'); }
  });
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F5, () => {
    if (isDebugging()) { sendDebugCommand('stop'); }
  });
  initFormatMenu();
  initEditMenu(editor);
  initLintMenu();
}
