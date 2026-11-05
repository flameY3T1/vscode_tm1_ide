/**
 * Tiny indirection so `grid.ts` can cancel a pending picklist editor before
 * `renderGrid` replaces `<td>`s, without importing `editor.ts` directly —
 * `editor.ts` → `actions.ts` → `axis.ts` → `grid.ts` closes a cycle, fails
 * `npm run lint:deps` (same problem `refreshBridge.ts` already solves for
 * `axis.ts` → refresh). `messaging.ts` registers the real
 * `cancelPendingPicklistEditor` here at startup; `grid.ts` calls
 * `cancelPendingPicklistBeforeRerender()` at the top of `renderGrid` — a
 * single choke point that covers every current AND future call site
 * (click-driven re-renders included), not just the message-driven ones
 * `messaging.ts` already guards individually via `_cancelEditorBeforeRerender`.
 *
 * No vscode/DOM imports — pure module.
 */

type CancelFn = () => void;

let _cancel: CancelFn | null = null;

export function setCancelPendingPicklistFn(fn: CancelFn): void {
  _cancel = fn;
}

export function cancelPendingPicklistBeforeRerender(): void {
  _cancel?.();
}
