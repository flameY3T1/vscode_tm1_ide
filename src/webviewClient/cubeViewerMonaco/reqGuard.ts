/** Request-generation guard for the cubeViewer webview.
 *
 * Fixes A2/B2: an in-flight `cellData` response from a pre-pivot refresh
 * could overwrite the user's current axis layout if it arrived after a
 * later pivot/refresh was already issued. Every outbound `refreshData` /
 * `runInlineMdx` / `switchView` message is stamped with a monotonically
 * increasing `reqId` (via `nextReqId`); the host echoes it back on the
 * matching `cellData` response. `isCurrentResponse` drops responses whose
 * `reqId` no longer matches the latest sent request.
 *
 * There is no unversioned `cellData` any more: the refresh after a write is
 * sent by the webview itself, with its own `reqId` (review 2026-11-02, C4/C8).
 * A reply without one was accepted unconditionally and could land after,
 * and over, a newer request.
 */

export function nextReqId(state: { _reqSent: number }): number {
  state._reqSent += 1;
  return state._reqSent;
}

export function isCurrentResponse(msgReqId: number | undefined, sent: number): boolean {
  return msgReqId === sent;
}
