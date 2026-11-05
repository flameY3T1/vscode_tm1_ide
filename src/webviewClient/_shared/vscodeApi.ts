/**
 * The one `acquireVsCodeApi()` call per webview.
 *
 * VS Code throws on a second `acquireVsCodeApi()` in the same webview, so the
 * handle is memoised: every module of a bundle that asks gets the same
 * instance. Typed by the bundle's webview-to-host union, so an unknown
 * outbound message `type` fails to compile.
 *
 * Import the handle, never `declare const vscode` — see
 * `src/test/noWebviewVscodeGlobal.test.ts`.
 */
export interface VsCodeApi<TOut, TState = unknown> {
  postMessage(msg: TOut): void;
  getState(): TState | undefined;
  setState(state: TState): void;
}

declare function acquireVsCodeApi(): VsCodeApi<unknown>;

let handle: VsCodeApi<unknown> | undefined;

/**
 * The webview API, typed by the outbound union `TOut` (mandatory: defaults to
 * `never`) and the shape the bundle keeps in `setState`.
 */
export function getVsCodeApi<TOut = never, TState = unknown>(): VsCodeApi<TOut, TState> {
  handle ??= acquireVsCodeApi();
  return handle as VsCodeApi<TOut, TState>;
}

/** Same, but `null` where no webview bridge exists (module loaded outside a webview, e.g. in a unit test). */
export function tryGetVsCodeApi<TOut = never, TState = unknown>(): VsCodeApi<TOut, TState> | null {
  return typeof acquireVsCodeApi === 'function' ? getVsCodeApi<TOut, TState>() : null;
}
