/**
 * Default of "save as MDX" in the save dialog of the cube viewer.
 *
 * Until 2026-08-04 the dialog made the choice SILENTLY: if an MDX view was loaded, it went to
 * `saveMdxView`, otherwise native. None of that was visible, so a
 * view could not be stored as MDX deliberately either.
 *
 * The rule (agreed with flameY3T1): pre-checked in EVERY case — unless a
 * real native view is loaded. A freshly opened cube and self-pivoted
 * axes thereby save as MDX. Pivoting releases the binding to a
 * loaded view anyway (`axis.ts` sets `existingViewName = null`), so the case
 * falls out correctly here by itself.
 *
 * The checkbox stays operable in all cases — it is a default, not a
 * one-way street.
 */

import { describe, it, expect } from 'vitest';
import { mdxSaveDefaultOn } from '../webviewClient/cubeViewerMonaco/viewSaveMode';

describe('mdxSaveDefaultOn', () => {
  it('is OFF when a native view is loaded', () => {
    expect(mdxSaveDefaultOn({ existingViewName: 'Umsatz Ist', isMdxView: false, pendingMdx: null }))
      .toBe(false);
  });

  it('is ON when an MDX view is loaded', () => {
    expect(mdxSaveDefaultOn({ existingViewName: 'Umsatz MDX', isMdxView: true, pendingMdx: null }))
      .toBe(true);
  });

  it('is ON for a freshly opened cube without a loaded view', () => {
    expect(mdxSaveDefaultOn({ existingViewName: null, isMdxView: false, pendingMdx: null }))
      .toBe(true);
  });

  it('is ON when the dialog came from the MDX window — even over a native view', () => {
    // `pendingMdx` means: the user has MDX in front of them right now and wants to save EXACTLY that.
    // A native view that is still loaded alongside changes nothing about that.
    expect(mdxSaveDefaultOn({ existingViewName: 'Umsatz Ist', isMdxView: false, pendingMdx: 'SELECT …' }))
      .toBe(true);
  });
});
