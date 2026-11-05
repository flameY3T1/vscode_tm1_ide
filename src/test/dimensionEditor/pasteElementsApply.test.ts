import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * `pasteClipboard` applies the planned paste operation to the draft.
 *
 * Reason: the first version did not set `data.dirty`. The pure part was green,
 * the elements were visible in the tree — but "Save" stayed grayed out,
 * and the hierarchy switch did not warn but silently discarded what had been pasted.
 * `updateDirty()` only READS the flag; the mutation path itself has to set it.
 *
 * The rendering part is mocked away — this is solely about the draft.
 */
vi.mock('../../webviewClient/dimensionEditor/tree', () => ({ renderTree: () => {} }));
vi.mock('../../webviewClient/dimensionEditor/detail', () => ({ renderDetail: () => {} }));
vi.mock('../../webviewClient/dimensionEditor/modals', () => ({ showInfo: () => {} }));
vi.mock('../../webviewClient/dimensionEditor/helpers', () => ({ updateDirty: () => {} }));

type Draft = {
  elements: Record<string, { name: string; type: string; attrs: Record<string, string>; marked: string }>;
  edges: Array<{ parent: string; child: string; weight: number; marked: string; order?: number }>;
  dirty: boolean;
};

describe('pasteClipboard', () => {
  let pasteClipboard: (target: string | null) => void;
  let state: { data: Draft | null; clipboard: unknown; collapsed: Set<string> };

  beforeAll(async () => {
    // `state` calls `acquireVsCodeApi()` at module load.
    vi.resetModules();
    (globalThis as Record<string, unknown>).acquireVsCodeApi =
      () => ({ postMessage: () => { /* kein Host im Test */ } });
    ({ pasteClipboard } = await import('../../webviewClient/dimensionEditor/pasteElements'));
    ({ state } = await import('../../webviewClient/dimensionEditor/state') as never);
  });

  beforeEach(() => {
    state.data = { elements: {}, edges: [], dirty: false };
    state.collapsed = new Set<string>();
    state.clipboard = {
      elements: [{ name: 'Top', type: 'C' }, { name: 'A', type: 'N' }],
      edges: [{ parent: 'Top', child: 'A', weight: 1 }],
    };
  });

  it('marks the draft as changed — otherwise Save stays disabled', () => {
    pasteClipboard(null);
    expect(state.data!.dirty).toBe(true);
  });

  it('carries elements with their type and the edges into the draft', () => {
    pasteClipboard(null);
    expect(state.data!.elements.Top).toMatchObject({ name: 'Top', type: 'C', marked: 'new' });
    expect(state.data!.elements.A).toMatchObject({ name: 'A', type: 'N', marked: 'new' });
    expect(state.data!.edges).toEqual([
      { parent: 'Top', child: 'A', weight: 1, marked: 'new', order: 0 },
    ]);
  });

  it('hangs the root under the target and expands it', () => {
    state.data!.elements.Ziel = { name: 'Ziel', type: 'C', attrs: {}, marked: 'clean' };
    state.collapsed.add('Ziel');
    pasteClipboard('Ziel');
    expect(state.data!.edges).toContainEqual(
      { parent: 'Ziel', child: 'Top', weight: 1, marked: 'new', order: 0 },
    );
    // If the target stayed collapsed, the user would think the paste had no effect.
    expect(state.collapsed.has('Ziel')).toBe(false);
  });

  it('leaves the draft untouched when there is nothing to do', () => {
    state.clipboard = { elements: [], edges: [] };
    pasteClipboard(null);
    expect(state.data!.dirty).toBe(false);
    expect(state.data!.edges).toEqual([]);
  });
});
