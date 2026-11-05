// src/test/dimBrowserColResize.test.ts
//
// `mouseDelta` is the distance to the RIGHT and is SUBTRACTED: the handle sits on the left
// of the column, dragging to the left makes it wider (instruction by flameY3T1, 2026-08-26).
import { describe, it, expect } from 'vitest';
import { computeWidth } from '../webviewClient/dimensionBrowser/colResize';

describe('computeWidth', () => {
  it('to the left makes it wider', () => {
    expect(computeWidth(160, -40)).toBe(200);
  });

  it('to the right makes it narrower', () => {
    expect(computeWidth(160, 60)).toBe(100);
  });

  it('clamps at the bottom — a column must not disappear', () => {
    expect(computeWidth(160, 500)).toBe(40);
  });

  it('rounds to whole pixels', () => {
    expect(computeWidth(160, -0.4)).toBe(160);
  });
});
