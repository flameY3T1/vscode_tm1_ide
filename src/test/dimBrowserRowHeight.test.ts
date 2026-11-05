// The measured row height.
//
// Measured 2026-08-24 (Chromium 1228): the height depends on font size AND
// display scaling as soon as the content exceeds the fixed 22px —
// 22.547 / 22.350 / 22.208 at deviceScaleFactor 1 / 1.25 / 1.5. A constant
// in the source would be off by 7,333 rows over 295,000 rows.
//
// The test environment has NO layout (vitest without jsdom): `getBoundingClientRect`
// only exists on the doubles if the test writes it there. Exactly this
// fallback is checked here — without it, all the other tests test an empty
// window and report green.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = { loaded: '{0} von {1}' };
});

import {
  _resetViewPathForTest, _rowHForTest, _measureRowHForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

/** A table body whose first data row reports a height. */
function koerperMitHoehe(h: number | null) {
  return {
    querySelector(sel: string) {
      if (sel !== 'tr.vw-row') { return null; }
      if (h === null) { return { /* without getBoundingClientRect */ }; }
      return { getBoundingClientRect: () => ({ height: h }) };
    },
  };
}

describe('Measuring the row height', () => {
  beforeEach(() => { _resetViewPathForTest(); });

  it('starts at the fallback', () => {
    expect(_rowHForTest()).toBe(22);
  });

  it('takes the measured height, even fractional', () => {
    expect(_measureRowHForTest(koerperMitHoehe(22.547))).toBeCloseTo(22.547, 5);
  });

  it('falls back to 22 when there is no row', () => {
    expect(_measureRowHForTest({ querySelector: () => null })).toBe(22);
  });

  it('falls back to 22 when the row knows no height', () => {
    expect(_measureRowHForTest(koerperMitHoehe(null))).toBe(22);
  });

  it('falls back to 22 when the height is 0 — no layout', () => {
    expect(_measureRowHForTest(koerperMitHoehe(0))).toBe(22);
  });

  it('falls back to 22 when the body cannot do anything at all', () => {
    expect(_measureRowHForTest({})).toBe(22);
    expect(_measureRowHForTest(null)).toBe(22);
  });
});
