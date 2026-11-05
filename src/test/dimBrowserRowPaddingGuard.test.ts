// Source-scan guard: the data row of the dimension browser carries
// `padding: 1px 10px`, not `2px 6px`.
//
// Measured 2026-08-24 (Chromium 1228, real webview CSS): `height: 22px` in
// `.dim-table tbody tr` is a MINIMUM, not a cap — the content pushes
// beyond it. With `2px 6px` a row at the VS Code default font size of
// 13px is 22.547px high instead of 22, with `1px 10px` exactly 22.000px (up to font size
// 14). The virtualiser computes placeholder heights from this number; 0.547px
// deviation amounts to an offset of 7,333 rows over 295,000 rows.
//
// The trap does not hurt: without the virtualiser it is not noticeable at all, and with
// it you only see that "something has shifted".
import { describe, it, expect } from 'vitest';
import { DIMENSION_BROWSER_CSS } from '../commands/dimension/dimensionBrowserCss';

describe('row padding of the dimension browser', () => {
  it('sets 1px vertically so the row stays exactly 22px high at a 13px font', () => {
    expect(DIMENSION_BROWSER_CSS).toContain('.vw-row td { padding: 1px 10px; white-space: nowrap; }');
  });

  it('no longer carries the old 2px padding', () => {
    expect(DIMENSION_BROWSER_CSS).not.toContain('.vw-row td { padding: 2px 6px');
  });

  it('still keeps the row height fixed — the arithmetic depends on it', () => {
    expect(DIMENSION_BROWSER_CSS).toContain('.dim-table tbody tr { height: 22px; }');
  });
});
