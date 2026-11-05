// An MDX that the host passes along on open can mean TWO different things
// — and the mix-up was visible in the click test:
//
//  • `newMdxViewCommand` builds a TEMPLATE. It belongs in the MDX window, so that
//    the user edits it. Executing it immediately would be pointless.
//  • Restoring a workbench hands over the state that the
//    window LAST SHOWED. That one should be executed — showing it in the editor
//    means handing the user back the work they saved
//    (click test "test2view", 2026-08-24: "there was an MDX that I still
//    had to run first").
//
// The difference is an intention of the caller and cannot be read off the
// expression. That is why the host states it, and this test pins down
// that the default stays the old one.
import { describe, it, expect } from 'vitest';
import { initialMdxAction } from '../webviewClient/cubeViewerMonaco/initialMdxPure';

describe('initialMdxAction', () => {
  it('does nothing without MDX', () => {
    expect(initialMdxAction({})).toBe('none');
    expect(initialMdxAction({ initialMdx: null })).toBe('none');
    expect(initialMdxAction({ initialMdx: '' })).toBe('none');
    expect(initialMdxAction({ initialMdx: '   ' })).toBe('none');
  });

  it('opens for editing when the host says nothing more', () => {
    // The default belongs to `newMdxViewCommand` — that was the only
    // caller when the parameter came into being.
    expect(initialMdxAction({ initialMdx: 'SELECT 1' })).toBe('edit');
    expect(initialMdxAction({ initialMdx: 'SELECT 1', initialMdxRun: false })).toBe('edit');
  });

  it('executes when the host asks for it', () => {
    expect(initialMdxAction({ initialMdx: 'SELECT 1', initialMdxRun: true })).toBe('run');
  });

  it('executes nothing that is empty — not even on request', () => {
    expect(initialMdxAction({ initialMdx: '  ', initialMdxRun: true })).toBe('none');
  });
});
