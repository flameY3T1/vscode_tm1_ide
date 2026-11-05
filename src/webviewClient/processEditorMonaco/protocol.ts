/**
 * Discriminated-union protocol for the Process Editor (Monaco)
 * webview ↔ extension-host bridge.
 *
 * Hebel 13 (2026-05-17): single source of truth for every `postMessage`
 * shape. Both sides import from this module — host
 * (`src/commands/processEditor/manager.ts`) and webview client
 * (`src/webviewClient/processEditorMonaco/index.ts` + submodules).
 *
 * Type-shapes are inlined (not re-exported from DOM-touching webview
 * submodules) so the host tsconfig — which excludes `src/webviewClient`
 * and does not load the DOM lib — can still import this protocol.
 */

export type { SectionKey } from './sectionTypes';
import type { ParamAsk, ParamsAnswer } from '../_shared/paramPromptProtocol';
import type { SectionKey } from './sectionTypes';
import type { TiFormatConfig } from '../../tiLogicVisualizer/formatRules';
import type { LintDiagnose } from '../../tiLogicVisualizer/lintTypes';
export type { TiFormatConfig } from '../../tiLogicVisualizer/formatRules';
import type { LintRuleConfig } from '../../tiLogicVisualizer/tiLinter/ruleConfig';
export type { LintRuleConfig } from '../../tiLogicVisualizer/tiLinter/ruleConfig';

export interface ProcessSections {
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
}

/** Postmessage-safe shape of a process parameter. */
export interface ProtocolProcessParameter {
  Name: string;
  Type: string;
  Value: string | number;
  Prompt?: string;
}

/** Postmessage-safe shape of a process variable. */
export interface ProtocolProcessVariable {
  Name: string;
  Type?: string;
  Position?: number;
  StartByte?: number;
  EndByte?: number;
  /** Editor-side flag: column has Contents="Ignore" (see utils/processVariablesUi.ts). */
  Ignored?: boolean;
}

/** Postmessage-safe shape of a process data source. */
export interface ProtocolDataSource {
  Type: string;
  [k: string]: unknown;
}

/** One diagnostic as the host's TI linter produces it (message already localized). */
export type LintDiagnostic = LintDiagnose;

export interface BreakpointRef {
  section: SectionKey;
  line: number;
  /** Optional TI boolean expression; pause only when it evaluates true. */
  condition?: string;
  /** Optional hit count condition string (e.g. ">=5", "%3"). */
  hitCondition?: string;
}

// ── Host → Webview ──────────────────────────────────────────────
export type HostToWebview =
  | { type: 'setExecuting'; running: boolean }
  /** Parameter prompt as an overlay in this editor (Execute / Debug); answered by `paramsAnswer`. */
  | ParamAsk
  | { type: 'setLoading'; loading: boolean }
  | { type: 'monacoSetContent'; sections: Partial<Record<SectionKey, string>> }
  /** File mode: the editor is a view of a `.ti` file — mirror every edit as `fileSync`. */
  | { type: 'monacoFileMode' }
  /** File mode: the file changed outside the editor; apply with undo kept. */
  | { type: 'monacoApplyExternal'; sections: Partial<Record<SectionKey, string>>; seq: number }
  /** Integration tests only (ExtensionMode.Test): act, then answer with `fileModeProbeResult`. */
  | { type: 'fileModeProbe'; action?: 'undo' | 'type'; section?: SectionKey; text?: string }
  | { type: 'monacoSetParameters'; parameters: ProtocolProcessParameter[] }
  | { type: 'monacoSetDataSource'; dataSource: ProtocolDataSource }
  | { type: 'monacoSetVariables'; variables: ProtocolProcessVariable[] }
  | { type: 'monacoSetSecurity'; hasSecurity: boolean }
  | { type: 'revealSectionLine'; section: SectionKey; line: number }
  | { type: 'pasteText'; text: string }
  /** indent: continuation lines take the cursor line's indent (tree insert only, not the public API). */
  | { type: 'insertText'; text: string; snippet?: boolean; indent?: boolean }
  | { type: 'cubeList'; cubes: string[] }
  | { type: 'viewList'; cubeName: string; views: string[] }
  | { type: 'dimensionList'; dimensions: string[] }
  | { type: 'subsetList'; dimensionName: string; subsets: string[] }
  | { type: 'odbcDsnList'; items: string[] }
  // With `params`: the host has sent them since 2026-09-20 (shared module
  // `providers/contextListFetch.ts`), and the client — the same as in the
  // TI console — builds the argument list from them. Previously only
  // `name`/`sig` were here, while the console had long been sending the types along: ONE
  // receiver, two contracts.
  | {
      type: 'processList';
      processes: Array<{
        name: string; sig: string;
        params?: Array<{ name: string; type: 'Numeric' | 'String' }>;
      }>;
    }
  | { type: 'cubesWithDims'; cubes: Array<{ name: string; dims: string[] }> }
  | { type: 'hierarchyList'; dimension: string; hierarchies: string[] }
  | { type: 'cubeDimensions'; cubeName: string; dimensions: string[] }
  | ({ type: 'asciiPreview'; error?: string } & Record<string, unknown>)
  | ({ type: 'odbcPreview'; error?: string } & Record<string, unknown>)
  | { type: 'lintResults'; section: string; diagnostics: LintDiagnostic[] }
  | { type: 'serverLintResults'; section: string; diagnostics: LintDiagnostic[] }
  | { type: 'compileResults'; errorsBySection: Record<string, unknown> }
  | { type: 'clearCompileResults' }
  | { type: 'saveError'; message: string }
  | { type: 'saveSuccess'; message: string }
  | { type: 'saveCancelled' }
  | { type: 'resolverData'; rows: unknown; error?: string }
  | { type: 'debugSessionStarted'; debugId: string }
  | ({ type: 'debugStateUpdate' } & Record<string, unknown>)
  // `status`/`errorMessage` are passed through from the debug REST answer
  // unchecked; the client renders them via String().
  | { type: 'debugSessionEnded'; status: unknown; errorMessage?: unknown }
  | { type: 'breakpointVerified'; section: string; line: number; verified: boolean }
  | { type: 'breakpointConditionError'; section: string; line: number; message: string }
  | { type: 'identifierInfo'; requestId: string; info: unknown }
  | { type: 'formatConfig'; config: TiFormatConfig }
  | { type: 'lintConfig'; config: LintRuleConfig }
  /**
   * Is v12 active for THIS panel? `v12DeprecatedNames` has always travelled along, but is
   * not evaluated in the webview — the deprecated marker comes from the
   * signatures themselves.
   */
  | { type: 'v12ModeChanged'; v12Mode: boolean; v12DeprecatedNames?: string[] }
  /**
   * The own TM1 snippets. Arrives when the panel is opened and again when
   * the snippet editor saves or deletes — the list belongs to the active
   * server and changes while the panel is open.
   */
  | { type: 'snippets'; snippets: WebviewSnippet[] };

export interface WebviewSnippet {
  id: string; trigger: string; name: string; description: string; body: string;
}

// ── Webview → Host ──────────────────────────────────────────────
export type WebviewToHost =
  | { type: 'monacoReady' }
  | { type: 'monacoContentChanged' }
  /**
   * Debounced mirror of the current editor state, for close/crash recovery.
   * A webview panel close cannot be intercepted, so the host can only park what
   * it already has — see `commands/processEditor/draftStore.ts`.
   */
  | {
      type: 'processDraft';
      sections: ProcessSections;
      parameters: ProtocolProcessParameter[];
      dataSource: ProtocolDataSource;
      variables: ProtocolProcessVariable[];
    }
  | {
      type: 'fileSync';
      sections: ProcessSections;
      parameters: ProtocolProcessParameter[];
      dataSource: ProtocolDataSource;
      variables: ProtocolProcessVariable[];
      hasSecurity: boolean;
      /** `seq` of the last `monacoApplyExternal` applied before this state was taken. */
      seenExternal: number;
    }
  | {
      type: 'fileModeProbeResult';
      sections: ProcessSections;
      parameterNames: string[];
      cursor: { section: SectionKey; line: number; column: number };
    }
  | { type: 'openExternal'; url: string }
  /** Answer to `askParams`. */
  | ParamsAnswer
  | { type: 'openProcess'; name: string }
  | { type: 'requestPaste' }
  | { type: 'requestCopy'; text: string }
  | {
      type: 'save' | 'saveAs' | 'execute';
      sections: ProcessSections;
      parameters: ProtocolProcessParameter[];
      dataSource: ProtocolDataSource;
      variables: ProtocolProcessVariable[];
      hasSecurity: boolean;
      errorCount: number;
    }
  | { type: 'fetchCubes' }
  | { type: 'fetchViews'; cubeName: string }
  | { type: 'fetchDimensions' }
  | { type: 'fetchSubsets'; dimensionName: string }
  | { type: 'fetchCubeDimensions'; cubeName: string }
  | { type: 'fetchOdbcDsns' }
  | ({ type: 'fetchAsciiPreview' } & Record<string, unknown>)
  | ({ type: 'fetchOdbcPreview' } & Record<string, unknown>)
  | { type: 'fetchProcesses' }
  | { type: 'fetchCubesWithDims' }
  | { type: 'fetchHierarchies'; dimension: string }
  | {
      type: 'requestLint';
      sections: ProcessSections;
      parameters: ProtocolProcessParameter[];
      variables: ProtocolProcessVariable[];
    }
  | {
      type: 'requestResolver';
      sections: ProcessSections;
      parameters: ProtocolProcessParameter[];
      variables: ProtocolProcessVariable[];
    }
  | {
      type: 'debugStart';
      parameters: Array<{ Name: string; Type?: string; Value: string | number; Prompt?: string }>;
      breakpoints: BreakpointRef[];
      sections?: Record<string, string>;
      dataSource?: unknown;
      variables?: unknown[];
      /** Optional editor error-count snapshot — used by host auto-save before debug. */
      errorCount?: number;
    }
  | {
      type: 'debugCommand';
      command: 'stepOver' | 'stepIn' | 'stepOut' | 'continue' | 'stop';
    }
  | { type: 'setBreakpoint'; section: SectionKey; line: number; enabled: boolean }
  | { type: 'setBreakpointCondition'; section: SectionKey; line: number; condition: string; hitCondition?: string }
  | ({ type: 'resolveIdentifier' } & Record<string, unknown>)
  | { type: 'setFormatConfig'; config: TiFormatConfig }
  | { type: 'setLintConfig'; config: LintRuleConfig }
  | { type: 'exportTiConfig' }
  | { type: 'importTiConfig' };
