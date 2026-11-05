// File mode: the editor is a view of a `.ti` file (CustomTextEditor on the host).
// Edits go out as `fileSync` (debounced, full state like the draft); foreign
// changes to the file come in as `monacoApplyExternal` and are applied with
// pushEditOperations so undo walks through them (setValue would wipe it).
import * as monaco from 'monaco-editor';
import { editor, models, sharedState, SECTION_ORDER, vscode, type SectionKey } from './state';
import { currentSections } from './sections';
import { getParameters, getSecurity } from './parameters';
import { getDataSource } from './dataSource';
import { getVariables } from './variables';
import { planSectionEdits } from './fileModePure';
import { switchToSection } from './sections';
import type { HostToWebview } from './protocol';

/** Short: an AI reading the file right after a keystroke should already see it. */
export const FILE_SYNC_DEBOUNCE_MS = 150;

let enabled = false;
/** `seq` of the last external change applied; echoed in every `fileSync`. */
let lastExternalSeq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export function enableFileMode(): void { enabled = true; }

export function scheduleFileSync(): void {
  if (!enabled) { return; }
  if (timer) { clearTimeout(timer); }
  timer = setTimeout(postFileSync, FILE_SYNC_DEBOUNCE_MS);
}

/** Sends a pending `fileSync` now: a save right after a keystroke pushes the files, so they must have it first. */
export function flushFileSync(): void {
  if (timer) { postFileSync(); }
}

function postFileSync(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  vscode.postMessage({
    type: 'fileSync', sections: currentSections(),
    parameters: getParameters(), dataSource: getDataSource(), variables: getVariables(),
    hasSecurity: getSecurity(), seenExternal: lastExternalSeq,
  });
}

/**
 * A pending `fileSync` was taken before this change and the host will drop it
 * (stale `seenExternal`). Typing in the changed region is replaced by the file's
 * text — the edit is on the undo stack, Ctrl+Z brings it back; edits elsewhere
 * survive and go out with a fresh sync.
 */
export function applyExternalSections(next: Partial<Record<SectionKey, string>>, seq: number): void {
  const hadPending = timer !== null;
  if (timer) { clearTimeout(timer); timer = null; }
  lastExternalSeq = seq;
  const current = Object.fromEntries(SECTION_ORDER.map(s => [s, models[s].getValue()])) as Record<SectionKey, string>;
  sharedState.suppressChange = true;
  try {
    for (const { section, edit } of planSectionEdits(current, next)) {
      const model = models[section];
      const range = monaco.Range.fromPositions(model.getPositionAt(edit.offset), model.getPositionAt(edit.offset + edit.length));
      const selections = editor.getModel() === model ? editor.getSelections() : null;
      model.pushStackElement();
      model.pushEditOperations(selections ?? [], [{ range, text: edit.text }], () => null);
      model.pushStackElement();
    }
  } finally {
    sharedState.suppressChange = false;
  }
  if (hadPending) { scheduleFileSync(); }
}

/** Integration-test hook: optionally act on a section, then report the editor state. */
export function answerProbe(msg: Extract<HostToWebview, { type: 'fileModeProbe' }>): void {
  if (msg.section) { switchToSection(msg.section); }
  if (msg.action === 'undo') { editor.trigger('probe', 'undo', null); }
  if (msg.action === 'type') { editor.trigger('probe', 'type', { text: msg.text ?? '' }); }
  const pos = editor.getPosition();
  const section = SECTION_ORDER.find(s => models[s] === editor.getModel()) ?? 'prolog';
  vscode.postMessage({
    type: 'fileModeProbeResult',
    sections: currentSections(),
    parameterNames: getParameters().map(p => p.Name),
    cursor: { section, line: pos?.lineNumber ?? 0, column: pos?.column ?? 0 },
  });
}
