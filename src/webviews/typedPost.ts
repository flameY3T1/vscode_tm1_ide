/**
 * Typed `webview.postMessage`.
 *
 * `vscode.Webview.postMessage(message: any)` accepts anything, so a renamed or
 * misspelt message `type` only shows up at runtime as a message the other side
 * silently ignores. Every host-side post goes through this helper instead,
 * with the webview's protocol union as the explicit type argument:
 *
 *   postTo<HostToWebview>(panel.webview, { type: 'saveSuccess', message });
 *
 * The type argument is mandatory: `M` defaults to `never` and is not inferred
 * from the message (`NoInfer`), so a call without it fails to compile.
 * Guard: `src/test/webviewProtocolGuard.test.ts` (no raw `.postMessage(` in
 * host code outside its shrinking allowlist).
 *
 * Structural target instead of `vscode.Webview`, so this module stays vscode-free.
 */
/** Anything with a `postMessage`: a `vscode.Webview`, or a test/lint sink. */
export interface MessageTarget {
  postMessage(message: unknown): unknown;
}

/** The `vscode.Webview` side of it: posting yields delivery. */
export interface WebviewTarget {
  postMessage(message: unknown): Thenable<boolean>;
}

export function postTo<M = never>(target: WebviewTarget, msg: NoInfer<M>): Thenable<boolean>;
/** `undefined` target = no-op, like the `panel?.webview.postMessage(...)` it replaces. */
export function postTo<M = never>(target: WebviewTarget | undefined, msg: NoInfer<M>): Thenable<boolean> | undefined;
export function postTo<M = never>(target: MessageTarget | undefined, msg: NoInfer<M>): unknown;
export function postTo<M>(target: MessageTarget | undefined, msg: M): unknown {
  return target?.postMessage(msg);
}
