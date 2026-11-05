/**
 * Inline gutter condition editor for breakpoints.
 *
 * Right-click a breakpoint glyph → a floating input appears with variable-name
 * autocomplete. Enter commits, Esc cancels, blur commits.
 *
 * Pure export: `filterNames` (unit-tested).
 * Side-effecting export: `initBreakpointCondition` (wired in init.ts).
 */

import type * as monacoType from 'monaco-editor';
import { getCondition, getHitCondition, setBreakpointCondition, toggleBreakpoint } from './breakpoints';
import type { SectionKey } from './sectionTypes';

export interface ConditionBridge {
  getEditor(): monacoType.editor.IStandaloneCodeEditor;
  getCurrentSection(): SectionKey;
  hasBreakpoint(section: SectionKey, line: number): boolean;
  getVariableNames(): string[];
  labels: { placeholder: string; hitPlaceholder: string };
}

/** Blur commits after this delay so a click on a suggestion item (which blurs
 *  the input) lands first and isn't swallowed by an immediate close. */
const SUGGESTION_MOUSEDOWN_GRACE_MS = 120;

/** Pure: case-insensitive prefix filter over a name list. Empty prefix returns
 *  a shallow copy of the full list. */
export function filterNames(names: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  if (p === '') { return names.slice(); }
  return names.filter((n) => n.toLowerCase().startsWith(p));
}

function lastToken(value: string, caret: number): string {
  const upto = value.slice(0, caret);
  const m = upto.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  return m ? m[0] : '';
}

/** Builds the floating input + suggestion list DOM. No monaco dependency. */
function buildConditionDom(
  placeholder: string, initialValue: string,
  hitPlaceholder: string, hitInitial: string,
): { container: HTMLDivElement; input: HTMLInputElement; list: HTMLDivElement; hitInput: HTMLInputElement } {
  const container = document.createElement('div');
  container.className = 'bp-cond-editor';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bp-cond-input';
  input.placeholder = placeholder;
  input.value = initialValue;
  const list = document.createElement('div');
  list.className = 'bp-cond-suggest';
  const hitInput = document.createElement('input');
  hitInput.type = 'text';
  hitInput.className = 'bp-cond-input bp-cond-hit-input';
  hitInput.placeholder = hitPlaceholder;
  hitInput.value = hitInitial;
  container.append(input, list, hitInput);
  return { container, input, list, hitInput };
}

/** A single open condition editor. Owns its widget + DOM lifecycle. */
interface OpenCondition {
  key: string;
  close(commit: boolean): void;
}

/**
 * Manages the breakpoint condition editor. One instance is wired per editor; it
 * guarantees at most one open condition editor at a time (a second right-click
 * on the same line toggles it shut, a different line swaps it) so we never stack
 * duplicate-id content widgets that would strand their DOM nodes.
 */
class BreakpointConditionController {
  private active: OpenCondition | null = null;

  constructor(
    private readonly monaco: typeof monacoType,
    private readonly bridge: ConditionBridge,
  ) {}

  install(): void {
    const editor = this.bridge.getEditor();
    editor.onContextMenu((e) => {
      if (e.target.type !== this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) { return; }
      const line = e.target.position?.lineNumber;
      if (!line) { return; }
      // Suppress default Monaco context menu on glyph click.
      e.event.preventDefault();
      e.event.stopPropagation();
      this.openAt(this.bridge.getCurrentSection(), line);
    });
  }

  private openAt(section: SectionKey, line: number): void {
    const editor = this.bridge.getEditor();
    const editorKey = `${section}:${line}`;

    // Repeat right-click: close the open editor (same line = toggle shut and
    // stop; different line = swap) instead of stacking a duplicate widget.
    if (this.active) {
      const sameLine = this.active.key === editorKey;
      this.active.close(true);
      if (sameLine) { return; }
    }
    if (!this.bridge.hasBreakpoint(section, line)) { toggleBreakpoint(section, line); }

    const { container, input, list, hitInput } = buildConditionDom(
      this.bridge.labels.placeholder, getCondition(section, line) ?? '',
      this.bridge.labels.hitPlaceholder, getHitCondition(section, line) ?? '',
    );

    const widget: monacoType.editor.IContentWidget = {
      getId: () => `bp-cond-${section}-${line}`,
      getDomNode: () => container,
      getPosition: () => ({
        position: { lineNumber: line, column: 1 },
        preference: [this.monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    };
    editor.addContentWidget(widget);
    setTimeout(() => input.focus(), 0);

    const renderSuggestions = () => this.renderSuggestions(input, list);

    let closed = false;
    const handle: OpenCondition = {
      key: editorKey,
      close: (commit: boolean) => {
        if (closed) { return; }
        closed = true;
        if (this.active === handle) { this.active = null; }
        // Remove the widget FIRST so the field always disappears, even if the
        // commit below throws — otherwise a failed save would strand the input.
        editor.removeContentWidget(widget);
        if (commit) {
          try { setBreakpointCondition(section, line, input.value, hitInput.value); }
          catch (err) { console.error('[bpCond] failed to save condition', err); }
        }
      },
    };
    this.active = handle;

    input.addEventListener('input', renderSuggestions);
    // Commit on blur only if focus left the whole widget — moving between the
    // condition and hit-count inputs (or onto a suggestion item) must NOT close.
    const blurClose = () => {
      setTimeout(() => {
        if (!container.contains(document.activeElement)) { handle.close(true); }
      }, SUGGESTION_MOUSEDOWN_GRACE_MS);
    };

    input.addEventListener('keydown', (ev) => {
      // Stop ALL keys from reaching the surrounding Monaco editor, otherwise its
      // keybindings hijack them — e.g. Ctrl+C/X/V copy/cut the editor text
      // (":ENDIF;") instead of the input selection. Native input handling stays.
      ev.stopPropagation();
      // Enter in the condition field advances to the hit-count field instead of
      // committing, so both can be filled in one open.
      if (ev.key === 'Enter') { ev.preventDefault(); hitInput.focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); handle.close(false); editor.focus(); }
    });
    // The process editor also registers clipboard handlers on the editor container;
    // keep copy/cut/paste local to the input so they don't bubble there.
    for (const evt of ['copy', 'cut', 'paste']) {
      input.addEventListener(evt, (ev) => ev.stopPropagation());
    }
    input.addEventListener('blur', blurClose);
    renderSuggestions();

    hitInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); handle.close(true); editor.focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); handle.close(false); editor.focus(); }
    });
    for (const evt of ['copy', 'cut', 'paste']) {
      hitInput.addEventListener(evt, (ev) => ev.stopPropagation());
    }
    hitInput.addEventListener('blur', blurClose);
  }

  /** Render up to 8 variable-name suggestions for the token at the caret. */
  private renderSuggestions(input: HTMLInputElement, list: HTMLDivElement): void {
    const pos = input.selectionStart ?? input.value.length;
    const token = lastToken(input.value, pos);
    const names = filterNames(this.bridge.getVariableNames(), token);
    list.innerHTML = '';
    for (const name of names.slice(0, 8)) {
      const item = document.createElement('div');
      item.className = 'bp-cond-suggest-item';
      item.textContent = name;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const before = input.value.slice(0, pos - token.length);
        const after = input.value.slice(pos);
        input.value = before + name + after;
        input.selectionStart = input.selectionEnd = before.length + name.length;
        list.innerHTML = '';
      });
      list.append(item);
    }
  }
}

export function initBreakpointCondition(monaco: typeof monacoType, bridge: ConditionBridge): void {
  new BreakpointConditionController(monaco, bridge).install();
}
