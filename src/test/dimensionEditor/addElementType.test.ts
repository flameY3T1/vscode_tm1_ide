import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Since 2026-08-14, the create popup of the Dimension Editor offers the type choice
 * N/C/S; before that, the type was hard-coded to `'N'` — a consolidation only came about
 * as a side effect when you hung a child under it, and a string element
 * not at all.
 *
 * What is checked is the mapping from the select field (which returns strings) to the
 * element type. The interaction with the modal itself depends on the DOM and is covered by
 * the click test — there is no jsdom here for the webview.
 */
describe('toElementType', () => {
  let toElementType: (raw: string | undefined) => 'N' | 'C' | 'S';

  beforeAll(async () => {
    // `addElement` pulls in, via `state`, an `acquireVsCodeApi()` that runs at
    // MODULE LOAD — the globals must be in place before the import (same
    // pattern as in `dimEditorConfirmFocus.test.ts`).
    vi.resetModules();
    const g = globalThis as Record<string, unknown>;
    g.acquireVsCodeApi = () => ({ postMessage: () => { /* kein Host im Test */ } });
    ({ toElementType } = await import('../../webviewClient/dimensionEditor/addElement'));
  });

  it('passes the three valid types through', () => {
    expect(toElementType('N')).toBe('N');
    expect(toElementType('C')).toBe('C');
    expect(toElementType('S')).toBe('S');
  });

  it('falls back to N when nothing or nonsense arrives', () => {
    // A missing or manipulated field must never carry an invalid
    // element type into the draft — otherwise TM1 rejected the commit with a
    // message that does not point back to the popup.
    expect(toElementType(undefined)).toBe('N');
    expect(toElementType('')).toBe('N');
    expect(toElementType('X')).toBe('N');
    expect(toElementType('n')).toBe('N');
  });
});
