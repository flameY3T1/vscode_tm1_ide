import type * as monacoType from 'monaco-editor';

import type { SectionKey } from './sectionTypes';

const SECTION_ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];

/** Visual state of a breakpoint: `pending` = edit-mode or waiting for server ack,
 *  `active` = verified by debug session, `unverified` = server rejected. */
export type BpStatus = 'pending' | 'active' | 'unverified';

interface BreakpointBridge {
  getEditor(): monacoType.editor.IStandaloneCodeEditor;
  getModel(section: SectionKey): monacoType.editor.ITextModel;
  getCurrentSection(): SectionKey;
  /** Fired whenever the user toggles a breakpoint (not when status changes). */
  onBreakpointsChanged?(list: Array<{ section: SectionKey; line: number }>): void;
  /** True while a debug session is active — toggles should inform the server. */
  isDebugging?(): boolean;
  /** Send setBreakpoint message to the extension during a debug session. */
  sendSetBreakpoint?(section: SectionKey, line: number, enabled: boolean): void;
  /** Send condition update for an existing breakpoint during a debug session. */
  sendSetBreakpointCondition?(section: SectionKey, line: number, rule: { condition: string; hitCondition: string }): void;
}

/** One breakpoint = one entry. Status, condition and last eval-error live
 *  together, so a single map is the source of truth — no four parallel
 *  collections to keep hand-synced on every toggle/clear/status change. */
interface BpEntry {
  section: SectionKey;
  line: number;
  status: BpStatus;
  /** TI condition expression (absent = unconditional). */
  condition?: string;
  /** Hit count condition string (e.g. ">=5", "%3"). */
  hitCondition?: string;
  /** Last condition-eval error reported by the host (shown in glyph hover). */
  error?: string;
}

function key(section: SectionKey, line: number): string { return `${section}:${line}`; }

const state: {
  monaco: typeof monacoType | null;
  bridge: BreakpointBridge | null;
  /** All breakpoints keyed by "section:line" — single source of truth. */
  bps: Map<string, BpEntry>;
  /** Decoration IDs currently applied per section. */
  decorations: Record<SectionKey, string[]>;
  /** Entries parallel to `decorations[section]` (same order) — lets a content
   * change re-read each decoration's tracked range and re-anchor its line. */
  decoEntries: Record<SectionKey, BpEntry[]>;
} = {
  monaco: null,
  bridge: null,
  bps: new Map(),
  decorations: { prolog: [], metadata: [], data: [], epilog: [] },
  decoEntries: { prolog: [], metadata: [], data: [], epilog: [] },
};

/** Read-only view of a breakpoint for the overview tab. */
export interface BpOverviewEntry {
  section: SectionKey;
  line: number;
  status: BpStatus;
  condition?: string;
  hitCondition?: string;
}

/** All breakpoints, sorted by section order then line — for the overview tab. */
export function getBreakpointEntries(): BpOverviewEntry[] {
  const out: BpOverviewEntry[] = [];
  for (const e of state.bps.values()) {
    out.push({ section: e.section, line: e.line, status: e.status, condition: e.condition, hitCondition: e.hitCondition });
  }
  out.sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    return s !== 0 ? s : a.line - b.line;
  });
  return out;
}

/** Overview-tab refresh hook: fired on every add/remove/status/condition mutation. */
let _onMutated: (() => void) | null = null;
export function onBreakpointsMutated(fn: () => void): void { _onMutated = fn; }
function _notify(): void { _onMutated?.(); }

export function initBreakpoints(monaco: typeof monacoType, bridge: BreakpointBridge): void {
  state.monaco = monaco;
  state.bridge = bridge;

  const editor = bridge.getEditor();
  editor.onMouseDown((e) => {
    if (!state.monaco) { return; }
    // Left-click only: right-click is reserved for the condition editor
    // (breakpointCondition.ts onContextMenu). Without this guard a right-click
    // also toggles the breakpoint off, fighting the condition editor.
    if (!e.event.leftButton) { return; }
    if (e.target.type !== state.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) { return; }
    const line = e.target.position?.lineNumber;
    if (!line) { return; }
    toggleBreakpoint(bridge.getCurrentSection(), line);
  });

  // Ghost dot when hovering over the breakpoint column. Without it, the narrow
  // strip on the left is not recognizable as a clickable area — you only see
  // after the click whether you hit it.
  //
  // Its OWN decoration track, not folded into `applyDecorations`: the track there
  // is reset on every toggle, every server status change and every content
  // change, whereas a mouse pointer moves far more often. Two tracks mean two
  // independent `deltaDecorations` — the ghost dot can neither overwrite nor
  // lose the real breakpoint.
  editor.onMouseMove((e) => {
    if (!state.monaco) { return; }
    const overGutter = e.target.type === state.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
    const line = overGutter ? e.target.position?.lineNumber : undefined;
    _setHoverGlyph(bridge.getCurrentSection(), line);
  });
  editor.onMouseLeave(() => { _setHoverGlyph(bridge.getCurrentSection(), undefined); });

  for (const s of SECTION_ORDER) { applyDecorations(s); }
}

/** Line of the current ghost dot decoration; `undefined` = none. */
let _hoverLine: number | undefined;
let _hoverDecos: string[] = [];

/**
 * Sets (or clears) the ghost dot on `line`.
 *
 * It stays off on a line with a real breakpoint — otherwise a pale dot would
 * lie under the filled one and make it look dirty.
 */
function _setHoverGlyph(section: SectionKey, line: number | undefined): void {
  if (!state.monaco || !state.bridge) { return; }
  const target = line !== undefined && !state.bps.has(key(section, line)) ? line : undefined;
  if (target === _hoverLine) { return; }
  _hoverLine = target;
  const model = state.bridge.getModel(section);
  _hoverDecos = model.deltaDecorations(_hoverDecos, target === undefined ? [] : [{
    range: new state.monaco.Range(target, 1, target, 1),
    options: { isWholeLine: false, glyphMarginClassName: 'bp-gutter-hover' },
  }]);
}

export function toggleBreakpoint(section: SectionKey, line: number): void {
  const k = key(section, line);
  const had = state.bps.has(k);
  if (had) {
    state.bps.delete(k);
  } else {
    state.bps.set(k, { section, line, status: 'pending' });
  }
  applyDecorations(section);
  const bridge = state.bridge;
  bridge?.onBreakpointsChanged?.(getBreakpoints());
  if (bridge?.isDebugging?.()) {
    bridge.sendSetBreakpoint?.(section, line, !had);
  }
  _notify();
}

/** Update the verification status of a breakpoint — called when the debug server
 *  confirms (or rejects) a breakpoint. No-op if the breakpoint is gone. */
export function setBreakpointStatus(section: SectionKey, line: number, status: BpStatus): void {
  const entry = state.bps.get(key(section, line));
  if (!entry) { return; }
  entry.status = status;
  applyDecorations(section);
  _notify();
}

/** Set or clear (empty expr) condition and/or hit condition for a breakpoint.
 *  Re-renders the glyph and, during an active debug session, informs the host.
 *  No-op if the breakpoint doesn't exist (callers toggle it on first). */
export function setBreakpointCondition(section: SectionKey, line: number, expr: string, hitExpr = ''): void {
  const trimmed = expr.trim();
  const hitTrimmed = hitExpr.trim();
  const entry = state.bps.get(key(section, line));
  if (!entry) { return; }
  entry.condition = trimmed === '' ? undefined : trimmed;
  entry.hitCondition = hitTrimmed === '' ? undefined : hitTrimmed;
  entry.error = undefined;
  applyDecorations(section);
  state.bridge?.sendSetBreakpointCondition?.(section, line, { condition: trimmed, hitCondition: hitTrimmed });
  _notify();
}

export function getCondition(section: SectionKey, line: number): string | undefined {
  return state.bps.get(key(section, line))?.condition;
}

export function getHitCondition(section: SectionKey, line: number): string | undefined {
  return state.bps.get(key(section, line))?.hitCondition;
}

/** Host reported the condition failed to evaluate — show the reason in hover. */
export function setBreakpointConditionError(section: SectionKey, line: number, message: string): void {
  const entry = state.bps.get(key(section, line));
  if (!entry) { return; }
  entry.error = message;
  applyDecorations(section);
  _notify();
}

/** Reset all breakpoints back to `pending` — call when a debug session ends. */
export function resetBreakpointStatuses(): void {
  for (const entry of state.bps.values()) { entry.status = 'pending'; }
  for (const s of SECTION_ORDER) { applyDecorations(s); }
  _notify();
}

export function applyDecorations(section: SectionKey): void {
  if (!state.monaco || !state.bridge) { return; }
  const model = state.bridge.getModel(section);
  const lineCount = model.getLineCount();
  const decos: monacoType.editor.IModelDeltaDecoration[] = [];
  const entriesOrdered: BpEntry[] = [];
  for (const entry of state.bps.values()) {
    if (entry.section !== section) { continue; }
    if (entry.line < 1 || entry.line > lineCount) { continue; }
    entriesOrdered.push(entry);
    const cls =
      entry.status === 'active'     ? 'bp-gutter-active'
      : entry.status === 'unverified' ? 'bp-gutter-unverified'
      : 'bp-gutter-pending';
    const isConditional = !!entry.condition || !!entry.hitCondition;
    const glyphCls = isConditional ? `${cls} bp-cond` : cls;
    let hover = `Breakpoint (${entry.status})`;
    if (entry.condition) { hover += `\n\nCondition: ${entry.condition}`; }
    if (entry.hitCondition) { hover += `\n\nHit count: ${entry.hitCondition}`; }
    if (entry.error) { hover += `\n\n⚠ ${entry.error}`; }
    decos.push({
      range: new state.monaco.Range(entry.line, 1, entry.line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: glyphCls,
        glyphMarginHoverMessage: { value: hover },
        stickiness: state.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
  }
  state.decorations[section] = model.deltaDecorations(state.decorations[section], decos);
  state.decoEntries[section] = entriesOrdered;
}

/**
 * Re-anchor a section's breakpoints after its content changed. Monaco moves the
 * tracked decoration ranges when lines are inserted/removed above them; here we
 * read each decoration's current line back and re-key `state.bps` so breakpoints
 * follow their code instead of staying on an absolute line number. A breakpoint
 * whose line was deleted (decoration gone) is dropped; two that collapse onto the
 * same line are merged.
 */
export function syncBreakpointsFromContent(section: SectionKey): void {
  if (!state.monaco || !state.bridge) { return; }
  const model = state.bridge.getModel(section);
  const ids = state.decorations[section];
  const entries = state.decoEntries[section];
  if (!ids.length || ids.length !== entries.length) { return; }

  // Detect moves/deletions first — most keystrokes touch no breakpoint line.
  const moved: Array<{ entry: BpEntry; newLine: number | null }> = [];
  let changed = false;
  for (let i = 0; i < ids.length; i++) {
    const entry = entries[i];
    const range = model.getDecorationRange(ids[i]);
    const newLine = range ? range.startLineNumber : null;
    if (newLine !== entry.line) { changed = true; }
    moved.push({ entry, newLine });
  }
  if (!changed) { return; }

  // Re-key: drop this section's entries, re-add survivors at their tracked lines.
  for (const e of entries) { state.bps.delete(key(e.section, e.line)); }
  for (const { entry, newLine } of moved) {
    if (newLine === null) { continue; } // line deleted → breakpoint removed
    entry.line = newLine;
    const k = key(entry.section, entry.line);
    if (!state.bps.has(k)) { state.bps.set(k, entry); } // collapse collisions
  }
  applyDecorations(section);
  state.bridge.onBreakpointsChanged?.(getBreakpoints());
  _notify();
}

export function getBreakpoints(): Array<{ section: SectionKey; line: number; condition?: string; hitCondition?: string }> {
  const out: Array<{ section: SectionKey; line: number; condition?: string; hitCondition?: string }> = [];
  for (const s of SECTION_ORDER) {
    for (const entry of state.bps.values()) {
      if (entry.section !== s) { continue; }
      const item: { section: SectionKey; line: number; condition?: string; hitCondition?: string } = { section: s, line: entry.line };
      if (entry.condition) { item.condition = entry.condition; }
      if (entry.hitCondition) { item.hitCondition = entry.hitCondition; }
      out.push(item);
    }
  }
  return out;
}

/**
 * Remove every breakpoint in one pass ("Delete all" in the overview tab).
 *
 * The host protocol has no bulk form — `setBreakpoint` carries exactly one
 * section/line (`processEditor/messaging.ts`), and each removal maps to its own
 * `removeBreakpoint` call against the debug server. So during a live session
 * every removal is still sent individually; what is batched is the local work:
 * one decoration pass per section, one `onBreakpointsChanged` and one
 * `_notify()` (= one overview table rebuild) instead of one of each per
 * breakpoint.
 */
export function clearAllBreakpoints(): void {
  // Snapshot before clearing — the host still has to hear about each removal.
  const removed = getBreakpoints();
  state.bps.clear();
  for (const s of SECTION_ORDER) { applyDecorations(s); }
  const bridge = state.bridge;
  bridge?.onBreakpointsChanged?.(getBreakpoints());
  if (bridge?.isDebugging?.()) {
    for (const b of removed) { bridge.sendSetBreakpoint?.(b.section, b.line, false); }
  }
  _notify();
}
