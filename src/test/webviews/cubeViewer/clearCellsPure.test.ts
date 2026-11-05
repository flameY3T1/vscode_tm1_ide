import { describe, it, expect } from 'vitest';
import { planClear } from '../../../webviewClient/cubeViewerMonaco/clearCellsPure';

const noFlags = {};
const noValues = {};

describe('planClear', () => {
  it('without a selection there is nothing to do', () => {
    expect(planClear({ cells: [], cellFlags: noFlags, rawValues: noValues, values: noValues }))
      .toEqual({ ok: false, reason: 'empty' });
  });

  it('cells that are already empty produce no target — otherwise a POST for nothing', () => {
    const plan = planClear({
      cells: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }],
      cellFlags: noFlags,
      rawValues: {},
      values: { '0,0': '', '0,1': '' },
    });
    expect(plan).toEqual({ ok: false, reason: 'empty' });
  });

  it('filled cells become targets, empty ones in the same selection do not', () => {
    const plan = planClear({
      cells: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }, { ri: 1, ci: 0 }],
      cellFlags: noFlags,
      rawValues: { '0,0': '15.5', '1,0': '3' },
      values: { '0,0': '15,50', '0,1': '', '1,0': '3' },
    });
    expect(plan).toEqual({ ok: true, targets: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }] });
  });

  it('rawValues beats values — the display can look empty because of formatting', () => {
    const plan = planClear({
      cells: [{ ri: 2, ci: 3 }],
      cellFlags: noFlags,
      rawValues: { '2,3': '0.4' },
      values: { '2,3': '' },
    });
    expect(plan).toEqual({ ok: true, targets: [{ ri: 2, ci: 3 }] });
  });

  it('targets come in row order, then column order — the click order must not determine the write order', () => {
    const plan = planClear({
      cells: [{ ri: 2, ci: 1 }, { ri: 0, ci: 5 }, { ri: 0, ci: 2 }],
      cellFlags: noFlags,
      rawValues: { '2,1': '1', '0,5': '2', '0,2': '3' },
      values: {},
    });
    expect(plan).toEqual({
      ok: true,
      targets: [{ ri: 0, ci: 2 }, { ri: 0, ci: 5 }, { ri: 2, ci: 1 }],
    });
  });

  it('a consolidation in the selection aborts everything', () => {
    const plan = planClear({
      cells: [{ ri: 0, ci: 0 }, { ri: 1, ci: 0 }],
      cellFlags: { '1,0': { c: 1 } },
      rawValues: { '0,0': '1', '1,0': '1' },
      values: {},
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 1, ci: 0, why: 'consolidated' });
  });

  it('Regelzelle blockiert', () => {
    const plan = planClear({
      cells: [{ ri: 4, ci: 2 }],
      cellFlags: { '4,2': { r: 1 } },
      rawValues: { '4,2': '9' },
      values: {},
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 4, ci: 2, why: 'rule' });
  });

  it('gesperrte Zelle blockiert', () => {
    const plan = planClear({
      cells: [{ ri: 4, ci: 2 }],
      cellFlags: { '4,2': { u: 0 } },
      rawValues: { '4,2': '9' },
      values: {},
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 4, ci: 2, why: 'locked' });
  });

  // "All or nothing" means: the lock counts regardless of whether the cell
  // would have become a target at all. Otherwise the rejection would depend on the chance of whether
  // the locked cell currently holds a value.
  it('even an EMPTY locked cell blocks', () => {
    const plan = planClear({
      cells: [{ ri: 0, ci: 0 }, { ri: 0, ci: 1 }],
      cellFlags: { '0,1': { c: 1 } },
      rawValues: { '0,0': '5' },
      values: { '0,1': '' },
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 0, ci: 1, why: 'consolidated' });
  });

  // The message names one cell; which one must not depend on the click order
  // — otherwise the same rectangle points to two different cells on two occasions.
  it('with several locked cells the first one in row/column order is reported', () => {
    const plan = planClear({
      cells: [{ ri: 3, ci: 0 }, { ri: 1, ci: 7 }],
      cellFlags: { '3,0': { r: 1 }, '1,7': { u: 0 } },
      rawValues: { '3,0': '1', '1,7': '1' },
      values: {},
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 1, ci: 7, why: 'locked' });
  });

  // Order of the checks within ONE cell: the same as when pasting
  // (`planPaste`) — consolidation before rule before lock.
  it('consolidation beats rule and lock in the same cell', () => {
    const plan = planClear({
      cells: [{ ri: 0, ci: 0 }],
      cellFlags: { '0,0': { c: 1, r: 1, u: 0 } },
      rawValues: { '0,0': '1' },
      values: {},
    });
    expect(plan).toEqual({ ok: false, reason: 'blocked', ri: 0, ci: 0, why: 'consolidated' });
  });
});
