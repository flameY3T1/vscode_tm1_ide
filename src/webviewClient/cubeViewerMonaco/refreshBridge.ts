/**
 * Tiny indirection so `axis.ts` can trigger a grid refresh without importing
 * `messaging.ts` (which imports `axis.ts` → circular dependency, fails
 * `npm run lint:deps`). `messaging.ts` registers its `doRefresh` here at
 * startup; `axis.ts` (and any other caller) invokes `requestRefresh`. Both
 * depend on this leaf module, not on each other.
 *
 * No vscode/DOM imports — pure module.
 */

type RefreshFn = (suppressColsOverride?: boolean) => void;

let _refresh: RefreshFn | null = null;

export function setRefreshFn(fn: RefreshFn): void {
  _refresh = fn;
}

export function requestRefresh(suppressColsOverride?: boolean): void {
  _refresh?.(suppressColsOverride);
}
