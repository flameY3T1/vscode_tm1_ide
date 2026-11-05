/**
 * Ctrl/Cmd+click on the process-name argument of an `ExecuteProcess` /
 * `RunProcess` call → open that process in the editor (like "Go to Definition").
 *
 * Two cases are resolved:
 *  1. a string literal   — `ExecuteProcess('Load.Actuals', …)`
 *  2. a variable assigned a string literal — `sProc = 'Load.Actuals';
 *     ExecuteProcess(sProc, …)` — the nearest `<var> = '<name>'` assignment
 *     (scanning earlier sections in execution order, then the current section up
 *     to the use site) is resolved. Concatenations / runtime params are not
 *     resolvable and simply yield no navigation.
 *
 * Monaco has no cross-model definition navigation in the standalone webview
 * build, so instead of a DefinitionProvider we intercept the ctrl-click at the
 * mouse layer and ask the host to open the target process. A ctrl-hover
 * affordance (underline + pointer) mirrors VS Code's go-to-definition feel.
 *
 * Target detection is pure (`processNavPure.ts`) and unit-tested.
 */

import * as monaco from 'monaco-editor';
import { editor, models, vscode, SECTION_ORDER } from './state';
import type { SectionKey } from './sectionTypes';
import {
  findProcessCallTargets,
  processCallTargetAt,
  findProcessCallVarTargets,
  firstArgIdentifierAt,
  resolveVarLiteral,
} from './processNavPure';

export {};

let linkDecorations: string[] = [];

function clearLinkDecoration(): void {
  if (linkDecorations.length) {
    linkDecorations = editor.deltaDecorations(linkDecorations, []);
  }
}

/** Which section the editor is currently showing (its active model). */
function currentSectionKey(): SectionKey | null {
  const m = editor.getModel();
  return SECTION_ORDER.find(k => models[k] === m) ?? null;
}

/**
 * Source lines in execution order up to and including `useLine` in `section`:
 * every earlier section in full, then the current section's lines 1..useLine.
 * Used to resolve a variable to its nearest string-literal assignment.
 */
function linesUpToUse(section: SectionKey, useLine: number): string[] {
  const lines: string[] = [];
  for (const k of SECTION_ORDER) {
    if (k === section) {
      lines.push(...models[k].getLinesContent().slice(0, useLine));
      break;
    }
    lines.push(...models[k].getLinesContent());
  }
  return lines;
}

/** Resolve the process name targeted at (lineNumber, column), literal or variable. */
function resolveTargetAt(lineNumber: number, column: number): string | null {
  const model = editor.getModel();
  if (!model) { return null; }
  const lineText = model.getLineContent(lineNumber);
  const literal = processCallTargetAt(lineText, column);
  if (literal) { return literal; }
  const varName = firstArgIdentifierAt(lineText, column);
  if (!varName) { return null; }
  const section = currentSectionKey();
  if (!section) { return null; }
  return resolveVarLiteral(varName, linesUpToUse(section, lineNumber));
}

/** Decorate the process-name target at (line, column) as a clickable link. */
function showLinkDecoration(lineNumber: number, column: number): void {
  const model = editor.getModel();
  if (!model) { clearLinkDecoration(); return; }
  const lineText = model.getLineContent(lineNumber);

  // Literal process-name span.
  const lit = findProcessCallTargets(lineText).find(
    t => column >= t.literalStart - 1 && column <= t.literalEnd && t.name.length > 0,
  );
  if (lit) {
    setDecoration(lineNumber, lit.literalStart, lit.literalEnd);
    return;
  }

  // Variable that resolves to a literal — underline the identifier.
  const v = findProcessCallVarTargets(lineText).find(t => column >= t.start && column <= t.end);
  if (v && resolveTargetAt(lineNumber, column)) {
    setDecoration(lineNumber, v.start, v.end + 1);
    return;
  }

  clearLinkDecoration();
}

function setDecoration(lineNumber: number, startCol: number, endCol: number): void {
  linkDecorations = editor.deltaDecorations(linkDecorations, [{
    range: new monaco.Range(lineNumber, startCol, lineNumber, endCol),
    options: { inlineClassName: 'ti-proc-link', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
  }]);
}

export function initProcessNav(): void {
  editor.onMouseDown((e) => {
    const ev = e.event;
    if (!ev.leftButton || !(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.altKey) { return; }
    const pos = e.target.position;
    if (!pos) { return; }
    const name = resolveTargetAt(pos.lineNumber, pos.column);
    if (!name) { return; }
    // Suppress Monaco's default ctrl-click (adds a secondary cursor).
    ev.preventDefault();
    ev.stopPropagation();
    clearLinkDecoration();
    vscode.postMessage({ type: 'openProcess', name });
  });

  editor.onMouseMove((e) => {
    const ev = e.event;
    const pos = e.target.position;
    if ((ev.ctrlKey || ev.metaKey) && pos) {
      showLinkDecoration(pos.lineNumber, pos.column);
    } else {
      clearLinkDecoration();
    }
  });

  editor.onMouseLeave(() => clearLinkDecoration());
  // Drop the affordance the moment Ctrl/Cmd is released.
  editor.onKeyUp((e) => {
    if (e.keyCode === monaco.KeyCode.Ctrl || e.keyCode === monaco.KeyCode.Meta) {
      clearLinkDecoration();
    }
  });
}
