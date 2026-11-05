/**
 * Separate counter for `resolvePicklist` round trips (inline editor AND paste),
 * SEPARATE from `state._reqSent` (`reqGuard.ts`) - fix round 1, finding 1.
 *
 * `state._reqSent` is the REFRESH generation: `messaging.ts` uses it to discard
 * a `cellData`/`error` whose `reqId` is no longer the most recently sent one
 * (`isCurrentResponse`). A `resolvePicklist` round trip that advances the same
 * counter (as `editor.ts` did before this fix) makes every running refresh
 * response "stale" as soon as a picklist is resolved in the meantime - symptom:
 * click refresh, then paste into a picklist area while the response is still
 * on its way, `cellData` is discarded, `showLoading(false)` never runs, the
 * refresh button stays locked. `grid.ts`'s `_childReqSeq` (collapse queries)
 * keeps its own counter for the same reason.
 *
 * `editor.ts` and `paste.ts` share THIS one counter (not one local counter
 * each): a paste can resolve several definitions at the same time, the inline
 * editor only ever one - two independent local counters could still draw the
 * same value, and `messaging.ts`'s `picklistValues` dispatch would assign the
 * response to the wrong round trip (the same bug this fix is meant to remove,
 * just one level deeper).
 */
let _picklistReqSeq = 0;

export function nextPicklistReqId(): number {
  _picklistReqSeq += 1;
  return _picklistReqSeq;
}
