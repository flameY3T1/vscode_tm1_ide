/**
 * Discriminated-union protocol for the MDX Runner (Monaco)
 * webview ↔ extension-host bridge.
 *
 * P3-2 (Stufe 6b, 2026-07-04): single source of truth for every
 * `postMessage` shape, mirroring the cubeViewer pattern (Hebel 13). Both
 * sides import from this module — host (`src/commands/mdx/mdxRunner.ts`)
 * and webview client (`src/webviewClient/mdxRunnerMonaco/*.ts`).
 *
 * `MdxInMessage` / `MdxOutMessage` are the subset handled by the pure,
 * vscode-free `handleMdxMessage` in `src/mdx/messageHandler.ts` (execute /
 * paste / copy / cut / completions / validation / continueLoad / abort —
 * the query-execution round-trip). `webviewReady`, `openExternal`,
 * `deleteHistoryEntry`, `clearHistory`, `loadMdx`, `historyUpdate` are
 * panel-lifecycle / history concerns handled directly in `mdxRunner.ts` —
 * `HostToWebview` / `WebviewToHost` fold both groups into the full wire
 * protocol. `CompletionContext` / `ValidateRef` / `InvalidReason` /
 * `InvalidRef` are owned here too; `messageHandler.ts` imports them (single
 * source — no divergent copies).
 */

import type { CellsetTable } from '../../mdx/cellsetParser';
import type { MdxError } from '../../mdx/executeMdx';
import type { HistoryEntry } from '../../mdx/historyStore';

export type CompletionContext = 'cubes' | 'cubeDims' | 'dimElements';

export interface ValidateRef {
  dim: string;
  /** Hierarchy from `[Dim].[Hier].[Elem]`; absent = the dimension's default. */
  hier?: string;
  element: string;
  offset: number;
  length: number;
}

export type InvalidReason = 'unknown-element' | 'unknown-dimension' | 'dim-not-in-cube';

export interface InvalidRef extends ValidateRef {
  reason: InvalidReason;
}

// ── Webview → Host: query-execution round-trip (handled by handleMdxMessage) ──
export type MdxInMessage =
  | { type: 'execute';        mdx: string }
  | { type: 'requestPaste' }
  | { type: 'requestCopy';    text: string }
  | { type: 'getCompletions'; context: CompletionContext; cube?: string; dim?: string; hier?: string; reqId: number }
  | { type: 'validateNames';  version: number; cube: string | null; refs: ValidateRef[] }
  | { type: 'continueLoad';   cellsetId: string }
  | { type: 'abort';          cellsetId: string };

// ── Host → Webview: query-execution round-trip (produced by handleMdxMessage) ──
export type MdxOutMessage =
  | { type: 'result';           ok: true;  table: CellsetTable; elapsedMs: number }
  | { type: 'result';           ok: false; error: MdxError }
  | { type: 'pasteText';        text: string }
  | { type: 'completions';      context: CompletionContext; reqId: number; items: string[] }
  | { type: 'validationResult'; version: number; invalid: InvalidRef[] }
  | { type: 'cellCountWarning'; cellCount: number; limit: number; cellsetId: string };

// ── Host → Webview: full protocol ──────────────────────────────
export type HostToWebview =
  | MdxOutMessage
  | { type: 'loadMdx'; mdx: string }
  | { type: 'historyUpdate'; entries: HistoryEntry[] };

// ── Webview → Host: full protocol ──────────────────────────────
export type WebviewToHost =
  | MdxInMessage
  | { type: 'webviewReady' }
  | { type: 'openExternal'; url: string }
  | { type: 'deleteHistoryEntry'; index: number }
  | { type: 'clearHistory' };
