import type * as monacoType from 'monaco-editor';
import type { HostToWebview, WebviewToHost } from './protocol';
import { normalizeSection, type SectionKey } from './debugPure';
import { resetDebugVarsDiff } from './debugVarsDiff';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

export type DebugMode = 'edit' | 'running' | 'paused';

export interface DebugVariable {
  name: string;
  value: string | number | boolean;
}

interface DebugBridge {
  getEditor(): monacoType.editor.IStandaloneCodeEditor;
  getModel(section: SectionKey): monacoType.editor.ITextModel;
  switchToSection(section: SectionKey): void;
  /** Send a typed message to the extension host. */
  post(msg: WebviewToHost): void;
  /** Called when debug-mode or variables change — used to re-render resolver and toolbar. */
  onStateChanged(): void;
}

/** Subset of host→webview messages handled in this submodule. */
type DebugHostMessage = Extract<
  HostToWebview,
  { type: 'debugSessionStarted' | 'debugStateUpdate' | 'debugSessionEnded' }
>;

const SECTION_ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];

const state: {
  monaco: typeof monacoType | null;
  bridge: DebugBridge | null;
  mode: DebugMode;
  variables: DebugVariable[];
  currentSection: SectionKey | null;
  currentLine: number | null;
  /** Last session-end status + errorMessage — stays visible in the toolbar until the next debugStart. */
  lastEndStatus: string | null;
  lastEndError: string | null;
  /** Transient note for the status line (e.g. an action that was discarded).
   *  Cleared by the next state update so it cannot go stale. */
  note: string | null;
  /** Current-line decoration id per section. */
  lineDecos: Record<SectionKey, string[]>;
} = {
  monaco: null,
  bridge: null,
  mode: 'edit',
  variables: [],
  currentSection: null,
  currentLine: null,
  lastEndStatus: null,
  lastEndError: null,
  note: null,
  lineDecos: { prolog: [], metadata: [], data: [], epilog: [] },
};

export function initDebug(monaco: typeof monacoType, bridge: DebugBridge): void {
  state.monaco = monaco;
  state.bridge = bridge;
}

export function getDebugMode(): DebugMode { return state.mode; }
export function isDebugPaused(): boolean { return state.mode === 'paused'; }
export function isDebugging(): boolean { return state.mode !== 'edit'; }
export function getDebugVariables(): DebugVariable[] { return state.variables; }
export function getLastEndStatus(): { status: string | null; error: string | null } {
  return { status: state.lastEndStatus, error: state.lastEndError };
}
/** Transient status-line note (discarded action, unknown stop position). */
export function getDebugNote(): string | null { return state.note; }

/** Look up a variable value by name, case-insensitive; strips leading `!` (legacy
 *  parameter syntax). Returns null when no match or not paused. */
export function lookupDebugValue(ident: string): string | null {
  if (state.mode !== 'paused' || !ident) { return null; }
  const cleaned = ident.charAt(0) === '!' ? ident.slice(1) : ident;
  const lc = cleaned.toLowerCase();
  for (const v of state.variables) {
    if (String(v.name).toLowerCase() === lc) { return String(v.value); }
  }
  return null;
}

/** Called when the user clicks "Debuggen". Collects breakpoints + parameters and
 *  asks the extension to start a debug session. */
export function requestDebugStart(
  parameters: Array<{ Name: string; Type?: string; Value: string | number; Prompt?: string }>,
  breakpoints: Array<{ section: SectionKey; line: number }>,
  extras?: { sections?: Record<string, string>; dataSource?: unknown; variables?: unknown[] },
): void {
  if (!state.bridge) { return; }
  state.mode = 'running';
  state.bridge.post({
    type: 'debugStart',
    parameters,
    breakpoints,
    sections: extras?.sections,
    dataSource: extras?.dataSource,
    variables: extras?.variables,
  });
  state.bridge.onStateChanged();
}

export function sendDebugCommand(command: 'stepOver' | 'stepIn' | 'stepOut' | 'continue' | 'stop'): void {
  if (!state.bridge) { return; }
  if (state.mode !== 'paused') {
    // The user pressed a button — never swallow that without a trace. 'stop' is
    // the exception: aborting a still-running process is always legitimate.
    if (command !== 'stop') {
      console.warn(`[debug] command '${command}' ignored — debugger is not paused (mode=${state.mode})`);
      state.note = L.dbgActionIgnored;
      state.bridge.onStateChanged();
      return;
    }
  }
  state.note = null;
  state.mode = command === 'stop' ? 'edit' : 'running';
  state.bridge.post({ type: 'debugCommand', command });
  state.bridge.onStateChanged();
  if (command === 'stop') { clearCurrentLine(); }
}

/** Called by the Monaco index.ts when a message comes in from the extension. */
export function onDebugMessage(msg: DebugHostMessage): void {
  if (!msg || !msg.type) { return; }
  switch (msg.type) {
    case 'debugSessionStarted':
      state.mode = 'running';
      state.lastEndStatus = null;
      state.lastEndError = null;
      state.note = null;
      resetDebugVarsDiff();
      state.bridge?.onStateChanged();
      break;
    case 'debugSessionEnded':
      state.mode = 'edit';
      state.variables = [];
      state.lastEndStatus = msg.status ? String(msg.status) : 'Beendet';
      state.lastEndError = msg.errorMessage ? String(msg.errorMessage) : null;
      state.note = null;
      resetDebugVarsDiff();
      clearCurrentLine();
      state.bridge?.onStateChanged();
      break;
    case 'debugStateUpdate': {
      state.mode = msg.status === 'paused' ? 'paused' : 'running';
      state.variables = Array.isArray(msg.variables) ? msg.variables : [];
      state.note = null;
      // `undefined` = the server did not report a position. Do NOT fall back to
      // Prolog: switching sections and highlighting line 1 would point the user
      // at code the process is not executing.
      const section = normalizeSection(msg.currentSection);
      const line = Number(msg.currentLine ?? 0) || null;
      if (state.mode === 'paused' && (!section || !line)) {
        console.warn(`[debug] paused without a known position (section=${String(msg.currentSection)}, line=${String(msg.currentLine)}) — no highlight`);
        state.note = L.dbgUnknownPosition;
      }
      if (state.mode === 'paused' && section && line) {
        // During a pause the host keeps polling and reports the same position
        // again. Only a CHANGE (step, next breakpoint) may move tab and
        // viewport — otherwise you get thrown back at the poll interval while scrolling or
        // reading in another section.
        if (state.currentSection !== section || state.currentLine !== line) {
          focusCurrentLine(section, line);
          // Set after `focusCurrentLine`: it internally clears the old marker
          // via `clearCurrentLine()`, which sets both fields to null.
          state.currentSection = section;
          state.currentLine = line;
        }
      } else {
        clearCurrentLine();
      }
      state.bridge?.onStateChanged();
      break;
    }
  }
}

function focusCurrentLine(section: SectionKey, line: number): void {
  if (!state.monaco || !state.bridge) { return; }
  // Clear previous decoration (on any section) first.
  clearCurrentLine();
  state.bridge.switchToSection(section);
  const model = state.bridge.getModel(section);
  const lineCount = model.getLineCount();
  const safeLine = Math.max(1, Math.min(lineCount, line));
  state.lineDecos[section] = model.deltaDecorations([], [{
    range: new state.monaco.Range(safeLine, 1, safeLine, 1),
    options: {
      isWholeLine: true,
      className: 'ti-debug-current-line',
      glyphMarginClassName: 'ti-debug-current-glyph',
    },
  }]);
  const editor = state.bridge.getEditor();
  editor.revealLineInCenter(safeLine);
}

function clearCurrentLine(): void {
  if (!state.monaco || !state.bridge) { return; }
  for (const s of SECTION_ORDER) {
    const model = state.bridge.getModel(s);
    state.lineDecos[s] = model.deltaDecorations(state.lineDecos[s], []);
  }
  state.currentSection = null;
  state.currentLine = null;
}
