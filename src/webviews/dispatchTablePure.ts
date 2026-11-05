/**
 * Typed webview-message dispatch table (A2/A4 convention, 2026-07-03).
 *
 * Replaces the hand-written `switch (msg.type)` routers in the webview
 * message backends (`dimensionBrowserHandlers`, and — via A4 — `cubeViewer`,
 * `processEditor`, `dimensionEditor`) with an exhaustive, per-case-testable
 * lookup table.
 *
 * Properties:
 *  - **Exhaustive**: `DispatchTable<TMsg, TCtx>` is a mapped type over the
 *    discriminant union `TMsg['type']`, so a missing case is a *compile error*.
 *  - **Injectable**: each handler receives a `ctx` object (the backend chooses
 *    its shape — typically `{ panel, post, config, options }`). Handlers touch
 *    no module globals, so they can be unit-tested with a fake `ctx` that stubs
 *    `post`/`config`.
 *  - **Narrowed**: within a handler, `msg` is narrowed to the exact member of
 *    the union for that `type` via `Extract`.
 *
 * vscode-free / pure → no layer break under depcruise; usable from any layer.
 *
 * @example
 *   interface Ctx { post: (m: Out) => void; config?: Cfg; }
 *   const table: DispatchTable<In, Ctx> = {
 *     ping: (msg, { post }) => post({ type: 'pong', id: msg.id }),
 *     load: async (msg, { post, config }) => post({ type: 'data', rows: await fetch(msg.q, config) }),
 *   };
 *   await dispatch(table, incomingMsg, { post, config });
 */

/** A single handler: receives the narrowed message + an injected context. */
export type MsgHandler<TMsg, TCtx> = (msg: TMsg, ctx: TCtx) => void | Promise<void>;

/** Exhaustive map from every `msg.type` in the union to its handler. */
export type DispatchTable<TMsg extends { type: string }, TCtx> = {
  [K in TMsg['type']]: MsgHandler<Extract<TMsg, { type: K }>, TCtx>;
};

/**
 * Look up `msg.type` in `table` and invoke the handler with `(msg, ctx)`.
 * Unknown types are ignored (the map is exhaustive at compile time, so this
 * only guards against untyped runtime input).
 */
export async function dispatch<TMsg extends { type: string }, TCtx>(
  table: DispatchTable<TMsg, TCtx>,
  msg: TMsg,
  ctx: TCtx,
): Promise<void> {
  const handler = table[msg.type as TMsg['type']] as MsgHandler<TMsg, TCtx> | undefined;
  if (handler) {
    await handler(msg, ctx);
  } else {
    console.warn(`[dispatchTable] no handler for message type: ${msg.type}`);
  }
}
