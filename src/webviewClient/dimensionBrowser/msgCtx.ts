/**
 * Shared context + table type of the host-to-webview message handlers.
 *
 * S2-11 (2026-08-02): `msg.ts` was a 768-line `else if` chain over 19
 * message types. The chain is now a table - the same mechanism
 * the host side already uses (`DispatchTable<WebviewToHost,
 * DimBrowserCtx>` in `commands/dimension/dimensionBrowserHandlers.ts`): the
 * mapped type over `HostToWebview['type']` turns a missing handler into a
 * compile error. The chain never could do that - a new message type fell through
 * there silently.
 *
 * The context only carries the `acquireVsCodeApi` handle, because that is initialized solely in the
 * index module and passed in via the `initMsgHandler` argument.
 */

import type { DispatchTable } from '../../webviews/dispatchTablePure';
import type { HostToWebview, WebviewToHost } from './protocol';

export interface MsgCtx {
  vscode: { postMessage: (msg: WebviewToHost) => void } | null;
}

/**
 * The complete handler table. The topic modules each export a
 * `Pick<>` slice of it; `msg.ts` assembles them into a `MsgTable` and
 * gets the completeness check in the process.
 */
export type MsgTable = DispatchTable<HostToWebview, MsgCtx>;
