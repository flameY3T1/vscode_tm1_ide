import { describe, it, expect } from 'vitest';
import { isCurrentSelection } from '../webviewClient/dimensionBrowser/pure';

// P1-2 (stage 4 race protocols): an answer for a dim/hier that the
// browser is no longer looking at (hier switch A->B, a slow answer for A lands
// after B) must never overwrite the data of the CURRENT selection.
//
// Until 2026-08-26 this file additionally checked `isStaleSeq` and the
// `setElementPage` path of `initMsgHandler`. Both belonged to the old
// loading path: since its removal the message has no handler anymore, and
// `isStaleSeq` has no caller (review 2026-08-24, H6). The ordering race
// of the same dim/hier is rejected in the new path via the run identifier in `viewPath.ts`.

describe('isCurrentSelection — pure dim/hier guard', () => {
  it('true when both dim and hier match the current selection', () => {
    expect(isCurrentSelection('DimB', 'HierB', 'DimB', 'HierB')).toBe(true);
  });

  it('false when dim differs', () => {
    expect(isCurrentSelection('DimA', 'HierB', 'DimB', 'HierB')).toBe(false);
  });

  it('false when hier differs (same dim, hier switch)', () => {
    expect(isCurrentSelection('DimB', 'HierA', 'DimB', 'HierB')).toBe(false);
  });
});
