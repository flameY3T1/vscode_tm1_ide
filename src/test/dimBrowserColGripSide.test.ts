// Source guard: the drag grip of the attribute column sits on the LEFT.
//
// Instruction by flameY3T1, 2026-08-26: anyone who wants to drag an attribute
// column wider grabs the divider BEFORE its name. On the right edge the same
// line read as belonging to the NEXT column — you widened the wrong column.
//
// The sign goes with it: dragging to the LEFT makes it wider, the gesture is
// "pull open outwards". The grabbed edge does not move along with it: under
// `table-layout: fixed` the left edge of a column is fixed, it always grows
// to the right — known and accepted.
//
// The padding of the header cell is 10px, the grip is 5px wide — so it does
// not cover the column name. If the padding goes, the grip covers text.
import { describe, it, expect } from 'vitest';
import { DIMENSION_BROWSER_CSS } from '../commands/dimension/dimensionBrowserCss';
import { computeWidth } from '../webviewClient/dimensionBrowser/colResize';

describe('drag grip of the attribute column', () => {
  it('sits on the left edge of the header cell', () => {
    expect(DIMENSION_BROWSER_CSS).toContain('position: absolute; top: 0; left: 0; width: 5px; height: 100%;');
  });

  it('no longer sits on the right', () => {
    expect(DIMENSION_BROWSER_CSS).not.toContain('top: 0; right: 0; width: 5px');
  });

  it('leaves the column name its padding — otherwise the grip covers text', () => {
    expect(DIMENSION_BROWSER_CSS).toContain('padding: 6px 10px 7px; text-align: left;');
  });

  it('dragging to the left makes it wider', () => {

    expect(computeWidth(120, -40)).toBe(160);
    expect(computeWidth(120, 40)).toBe(80);
  });
});
