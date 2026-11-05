// Message contract of the TI console. Deliberately placed under `webviewClient/`, so that
// the client can import it without touching a vscode-dependent module
// (depcruise rule `webview-no-vscode`) — the host side imports from here,
// not the other way round. Same pattern as `mdxRunnerMonaco/protocol.ts`.

import type { TiHistoryEntry } from '../../webviews/tiConsolePure';

export type WebviewToHost =
  | { type: 'webviewReady' }
  | { type: 'run'; code: string }
  /** Drop an entry from the history. */
  | { type: 'deleteHistoryEntry'; timestamp: number }
  | { type: 'clearHistory' }
  /** Clipboard — the webview must not touch it itself. */
  | { type: 'requestPaste' }
  | { type: 'requestCopy'; text: string }
  /** Server objects for completion in string arguments. */
  | { type: 'fetchCubes' }
  | { type: 'fetchDimensions' }
  | { type: 'fetchProcesses' }
  | { type: 'fetchCubesWithDims' }
  | { type: 'fetchHierarchies'; dimension: string };

export type HostToWebview =
  /** TM1 executed and returned a process status. */
  | { type: 'result'; ok: boolean; status: string; errorLog?: string; elapsedMs: number }
  /** Not executed at all: compile error, 401, network gone. */
  | { type: 'failed'; message: string }
  /** The user cancelled the run via the "Running" view. */
  | { type: 'cancelled' }
  /** The entire history of this server, complete every time. */
  | { type: 'historyUpdate'; entries: TiHistoryEntry[] }
  | { type: 'pasteText'; text: string }
  | { type: 'cubeList'; cubes: string[] }
  | { type: 'dimensionList'; dimensions: string[] }
  | { type: 'processList'; processes: Array<{ name: string; sig: string; params?: Array<{ name: string; type: 'Numeric' | 'String' }> }> }
  | { type: 'cubesWithDims'; cubes: Array<{ name: string; dims: string[] }> }
  | { type: 'hierarchyList'; dimension: string; hierarchies: string[] };
