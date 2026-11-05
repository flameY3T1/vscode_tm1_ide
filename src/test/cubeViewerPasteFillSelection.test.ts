/**
 * Paste a SINGLE copied value onto a MULTI-CELL selection
 * (Excel "fill" behavior): the grid is 1×1, the selection has n cells —
 * then the block shape from the anchor does not apply; instead every selected cell
 * gets the same value.
 *
 * Pure logic, no DOM: `pasteGridPure.ts` is vscode-free per depcruise.
 */
import { describe, it, expect } from 'vitest';
import { parseClipboardGrid, planPaste, pastePositions } from '../webviewClient/cubeViewerMonaco/pasteGridPure';

const ROWS = [0, 1, 2, 3];
const COLS = [0, 1, 2];

function base() {
  return {
    rowIndex: ROWS, colIndex: COLS,
    cellFlags: {} as Record<string, { c?: 1; r?: 1; u?: 0 } | undefined>,
    commaDecimal: false,
  };
}

describe('planPaste — a single value fills the whole selection', () => {
  it('writes the same value into every selected cell, not only into the anchor', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('42'),
      anchor: { ri: 1, ci: 1 },
      selection: [{ ri: 1, ci: 1 }, { ri: 2, ci: 1 }, { ri: 3, ci: 1 }],
    });
    expect(plan).toEqual({
      ok: true,
      targets: [
        { ri: 1, ci: 1, value: 42 },
        { ri: 2, ci: 1, value: 42 },
        { ri: 3, ci: 1, value: 42 },
      ],
    });
  });

  it('also fills a rectangle across several rows AND columns', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('7'),
      anchor: { ri: 0, ci: 0 },
      selection: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }, { ri: 1, ci: 0 }, { ri: 1, ci: 1 }],
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.targets).toHaveLength(4);
    expect(plan.ok && plan.targets.every((t) => t.value === 7)).toBe(true);
  });

  it('a text value is distributed onto the whole selection just the same', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('Offen'),
      anchor: { ri: 0, ci: 0 },
      selection: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }],
    });
    expect(plan.ok && plan.targets).toEqual([
      { ri: 0, ci: 0, value: 'Offen' },
      { ri: 1, ci: 0, value: 'Offen' },
    ]);
  });

  it('a single locked cell in the selection rejects the whole fill', () => {
    const plan = planPaste({
      ...base(),
      cellFlags: { '2,1': { c: 1 } },
      grid: parseClipboardGrid('42'),
      anchor: { ri: 1, ci: 1 },
      selection: [{ ri: 1, ci: 1 }, { ri: 2, ci: 1 }],
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 2, ci: 1, why: 'consolidated' });
  });

  it('checks the picklist PER selected cell — rejected ones drop out individually', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('Offen'),
      anchor: { ri: 0, ci: 0 },
      selection: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }],
      picklistValues: { '0,0': ['Offen', 'Zu'], '1,0': ['Zu'] },
    });
    expect(plan).toEqual({
      ok: true,
      targets: [{ ri: 0, ci: 0, value: 'Offen' }],
      rejectedByPicklist: [{ ri: 1, ci: 0, value: 'Offen' }],
    });
  });

  it('a selection with only ONE cell stays the normal anchor path', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('42'),
      anchor: { ri: 1, ci: 1 },
      selection: [{ ri: 1, ci: 1 }],
    });
    expect(plan).toEqual({ ok: true, targets: [{ ri: 1, ci: 1, value: 42 }] });
  });

  it('a multi-cell grid does NOT fill — the block shape from the anchor still applies', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('1\t2'),
      anchor: { ri: 0, ci: 0 },
      selection: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }, { ri: 2, ci: 0 }],
    });
    expect(plan).toEqual({
      ok: true,
      targets: [{ ri: 0, ci: 0, value: 1 }, { ri: 0, ci: 1, value: 2 }],
    });
  });

  it('without a selection everything stays as before', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('42'),
      anchor: { ri: 1, ci: 1 },
    });
    expect(plan).toEqual({ ok: true, targets: [{ ri: 1, ci: 1, value: 42 }] });
  });

  it('filling needs no visible anchor — the selection is the target', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('5'),
      anchor: null,
      selection: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }],
    });
    expect(plan.ok && plan.targets).toHaveLength(2);
  });

  it('filling cannot "not fit" — the selection lies within the grid', () => {
    const plan = planPaste({
      ...base(),
      grid: parseClipboardGrid('5'),
      anchor: { ri: 3, ci: 2 },
      selection: [{ ri: 3, ci: 2 }, { ri: 2, ci: 2 }],
    });
    expect(plan.ok).toBe(true);
  });
});

describe('pastePositions — the same mapping for the picklist resolution', () => {
  it('returns the selection when filling, not the anchor block', () => {
    const positions = pastePositions(
      parseClipboardGrid('42'), { ri: 1, ci: 1 }, ROWS, COLS,
      [{ ri: 1, ci: 1 }, { ri: 2, ci: 1 }],
    );
    expect(positions).toEqual([{ ri: 1, ci: 1 }, { ri: 2, ci: 1 }]);
  });

  it('stays with the anchor block without a multi-selection', () => {
    const positions = pastePositions(
      parseClipboardGrid('1\t2'), { ri: 0, ci: 0 }, ROWS, COLS,
      [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }],
    );
    expect(positions).toEqual([{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }]);
  });
});
