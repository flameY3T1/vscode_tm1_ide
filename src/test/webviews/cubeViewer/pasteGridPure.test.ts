import { describe, it, expect } from 'vitest';
import { parseClipboardGrid, planPaste } from '../../../webviewClient/cubeViewerMonaco/pasteGridPure';

describe('parseClipboardGrid', () => {
  // The most dangerous case: when copying ONE cell, Excel appends a \r\n.
  // Without the cut, a two-row block would result whose empty second row
  // EMPTIES the cell below.
  it('a cell with a trailing Excel line break stays one value', () => {
    expect(parseClipboardGrid('5\r\n')).toEqual([['5']]);
    expect(parseClipboardGrid('5\n')).toEqual([['5']]);
    expect(parseClipboardGrid('5\r\n\r\n')).toEqual([['5']]);
  });

  it('a column becomes n×1', () => {
    expect(parseClipboardGrid('5\n50\n11')).toEqual([['5'], ['50'], ['11']]);
    expect(parseClipboardGrid('5\r\n50\r\n11\r\n')).toEqual([['5'], ['50'], ['11']]);
  });

  it('Tabs trennen Spalten', () => {
    expect(parseClipboardGrid('1\t2\n3\t4')).toEqual([['1', '2'], ['3', '4']]);
  });

  it('an empty field in the middle is preserved', () => {
    expect(parseClipboardGrid('5\n\n11')).toEqual([['5'], [''], ['11']]);
    expect(parseClipboardGrid('1\t\t3')).toEqual([['1', '', '3']]);
  });

  it('short rows are padded with null', () => {
    expect(parseClipboardGrid('1\t2\n3')).toEqual([['1', '2'], ['3', null]]);
  });

  it('empty text yields an empty grid', () => {
    expect(parseClipboardGrid('')).toEqual([]);
    expect(parseClipboardGrid('\r\n')).toEqual([]);
  });

  it('a tab on its own is two empty fields', () => {
    expect(parseClipboardGrid('\t')).toEqual([['', '']]);
  });

  it('Tabs am Zeilenende bleiben erhalten', () => {
    expect(parseClipboardGrid('1\t\t')).toEqual([['1', '', '']]);
  });

  it('mixed lengths with trailing tabs', () => {
    expect(parseClipboardGrid('1\t2\n3\t\t')).toEqual([['1', '2', null], ['3', '', '']]);
  });

  it('leading line breaks are content', () => {
    expect(parseClipboardGrid('\n5')).toEqual([[''], ['5']]);
  });

  it('non-string input is treated as empty', () => {
    expect(parseClipboardGrid(undefined as unknown as string)).toEqual([]);
  });

  it('inner line breaks produce empty rows', () => {
    expect(parseClipboardGrid('5\r\n\r\n50')).toEqual([['5'], [''], ['50']]);
  });
});

/** Grid of 4 rows × 2 columns, visible without gaps, everything writable unless
 *  stated otherwise. `rowIndex`/`colIndex` are the visible order
 *  in raw index space (`state.renderedRowIdx`/`.renderedColIdx`) — without a gap
 *  identical to the former `rowCount`/`colCount`. */
function input(over: Partial<Parameters<typeof planPaste>[0]> = {}): Parameters<typeof planPaste>[0] {
  return {
    grid: [['5'], ['50'], ['11']],
    anchor: { ri: 0, ci: 0 },
    rowIndex: [0, 1, 2, 3],
    colIndex: [0, 1],
    cellFlags: {} as Record<string, { c?: 1; r?: 1; u?: 0; s?: 1 } | undefined>,
    commaDecimal: false,
    ...over,
  };
}

describe('planPaste', () => {
  it('a column from the anchor yields targets downwards', () => {
    expect(planPaste(input())).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 5 },
        { ri: 1, ci: 0, value: 50 },
        { ri: 2, ci: 0, value: 11 },
      ],
    });
  });

  it('a single value is a 1×1 block', () => {
    expect(planPaste(input({ grid: [['5']], anchor: { ri: 2, ci: 1 } })))
      .toEqual({ ok: true, targets: [{ ri: 2, ci: 1, value: 5 }] });
  });

  it('an empty grid is rejected', () => {
    expect(planPaste(input({ grid: [] }))).toEqual({ ok: false, reason: 'empty' });
  });

  it('without an anchor it is rejected', () => {
    expect(planPaste(input({ anchor: null }))).toEqual({ ok: false, reason: 'no-anchor' });
  });

  it('a block reaching the last loaded row fits', () => {
    expect(planPaste(input({ anchor: { ri: 1, ci: 0 } })).ok).toBe(true);
  });

  it('one row too many is rejected, without targets', () => {
    expect(planPaste(input({ anchor: { ri: 2, ci: 0 } }))).toEqual({
      ok: false, reason: 'does-not-fit',
      needRows: 3, needCols: 1, haveRows: 2, haveCols: 2,
    });
  });

  it('one column too many is rejected', () => {
    expect(planPaste(input({ grid: [['1', '2', '3']] }))).toEqual({
      ok: false, reason: 'does-not-fit',
      needRows: 1, needCols: 3, haveRows: 4, haveCols: 2,
    });
  });

  it('a consolidated cell in the block prevents EVERYTHING', () => {
    expect(planPaste(input({ cellFlags: { '1,0': { c: 1 } } })))
      .toEqual({ ok: false, reason: 'blocked', ri: 1, ci: 0, why: 'consolidated' });
  });

  it('rule cell and locked cell likewise', () => {
    expect(planPaste(input({ cellFlags: { '0,0': { r: 1 } } })))
      .toEqual({ ok: false, reason: 'blocked', ri: 0, ci: 0, why: 'rule' });
    expect(planPaste(input({ cellFlags: { '2,0': { u: 0 } } })))
      .toEqual({ ok: false, reason: 'blocked', ri: 2, ci: 0, why: 'locked' });
  });

  it('an empty field empties the cell', () => {
    const plan = planPaste(input({ grid: [['5'], [''], ['11']] }));
    expect(plan).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 5 },
        { ri: 1, ci: 0, value: '' },
        { ri: 2, ci: 0, value: 11 },
      ],
    });
  });

  it('reads numbers in the displayed notation', () => {
    expect(planPaste(input({ grid: [['1.234,50']], commaDecimal: true })))
      .toEqual({ ok: true, targets: [{ ri: 0, ci: 0, value: 1234.5 }] });
    expect(planPaste(input({ grid: [['1,234.50']], commaDecimal: false })))
      .toEqual({ ok: true, targets: [{ ri: 0, ci: 0, value: 1234.5 }] });
  });

  it('text stays text, a spread token is not interpreted', () => {
    expect(planPaste(input({ grid: [['Hinweis']] })))
      .toEqual({ ok: true, targets: [{ ri: 0, ci: 0, value: 'Hinweis' }] });
    expect(planPaste(input({ grid: [['P1000']] })))
      .toEqual({ ok: true, targets: [{ ri: 0, ci: 0, value: 'P1000' }] });
  });

  // Correction compared with the brief: the grid type is now Array<Array<string | null>>.
  // `null` = padding position (short row in the copied block) → NO target.
  it('a padding position (null) produces no target', () => {
    expect(planPaste(input({ grid: [['1', '2'], ['3', null]] }))).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 1 },
        { ri: 0, ci: 1, value: 2 },
        { ri: 1, ci: 0, value: 3 },
      ],
    });
  });

  it('a locked cell under a padding position blocks nothing, because nothing is written there', () => {
    expect(planPaste(input({
      grid: [['1', '2'], ['3', null]],
      cellFlags: { '1,1': { c: 1 } },
    }))).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 1 },
        { ri: 0, ci: 1, value: 2 },
        { ri: 1, ci: 0, value: 3 },
      ],
    });
  });

  it('a padding position still counts for the fit', () => {
    expect(planPaste(input({ grid: [['1', null]], anchor: { ri: 0, ci: 1 } }))).toEqual({
      ok: false, reason: 'does-not-fit',
      needRows: 1, needCols: 2, haveRows: 4, haveCols: 1,
    });
  });
});

// Correction compared with the brief: the pure function is still called `planPaste` (not
// `buildPasteTargets` — that name dates from before the paste.ts rework).
// Field names (`picklistValues`, `rejectedByPicklist`) and test cases are
// taken over verbatim from the brief.
describe('paste and picklists', () => {
  it('reports values outside the list separately instead of writing them', () => {
    const out = planPaste(input({
      grid: [['Offen'], ['UNBEKANNT']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0, 1], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: { '0,0': ['Offen', 'Zu'], '1,0': ['Offen', 'Zu'] },
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0].value).toBe('Offen');
    expect(out.rejectedByPicklist).toEqual([{ ri: 1, ci: 0, value: 'UNBEKANNT' }]);
  });

  it('lets cells without a list through unchanged', () => {
    const out = planPaste(input({
      grid: [['irgendwas']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: {},
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toHaveLength(1);
    expect(out.rejectedByPicklist).toEqual([]);
  });

  it('lets a cell through whose list could not be resolved', () => {
    // null means "TM1 allows everything here" — not "nothing allowed".
    const out = planPaste(input({
      grid: [['x']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: { '0,0': null },
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toHaveLength(1);
    expect(out.rejectedByPicklist).toEqual([]);
  });

  it('without picklistValues the return shape stays unchanged (no rejectedByPicklist key)', () => {
    expect(planPaste(input())).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 5 },
        { ri: 1, ci: 0, value: 50 },
        { ri: 2, ci: 0, value: 11 },
      ],
    });
  });

  // Fix round 1, finding 2: what is compared is the TRIMMED value (what TM1
  // actually gets to see), not the raw clipboard text.
  it('a value with surrounding whitespace is compared trimmed, not raw', () => {
    const out = planPaste(input({
      grid: [['Offen ']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: { '0,0': ['Offen', 'Zu'] },
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toEqual([{ ri: 0, ci: 0, value: 'Offen' }]);
    expect(out.rejectedByPicklist).toEqual([]);
  });

  // Fix round 1, finding 3 (decision of the coordinator): a deliberately
  // empty field empties the cell and is NOT a picklist violation, even if
  // the list itself contains no empty string.
  it('an empty field is not a picklist violation and empties the cell', () => {
    const out = planPaste(input({
      grid: [['Offen'], ['']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0, 1], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: { '0,0': ['Offen', 'Zu'], '1,0': ['Offen', 'Zu'] },
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toEqual([
      { ri: 0, ci: 0, value: 'Offen' },
      { ri: 1, ci: 0, value: '' },
    ]);
    expect(out.rejectedByPicklist).toEqual([]);
  });

  // Even a field that consists only of whitespace trims to empty and therefore
  // also counts as deliberate emptying, not as a violation.
  it('a field consisting only of whitespace also counts as empty', () => {
    const out = planPaste(input({
      grid: [['   ']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0], colIndex: [0],
      cellFlags: {},
      commaDecimal: false,
      picklistValues: { '0,0': ['Offen', 'Zu'] },
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.targets).toEqual([{ ri: 0, ci: 0, value: '' }]);
    expect(out.rejectedByPicklist).toEqual([]);
  });
});

// Rows/columns that `renderGrid` hides (collapsed consolidation,
// localFocus, occurrence hiding, empty-row suppression) remain in the
// raw index space as a gap — `rowIndex`/`colIndex` carry exactly these
// gaps. Pasting must map via the position in the visible list,
// not via the raw index itself.
describe('planPaste — gaps in rowIndex/colIndex (hidden rows/columns)', () => {
  it('a gap in rowIndex is skipped when mapping — never index 1', () => {
    // rowIndex [0, 2, 3]: the row with raw index 1 is hidden (e.g. collapsed).
    expect(planPaste(input({
      grid: [['5'], ['50'], ['11']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0, 2, 3],
    }))).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 5 },
        { ri: 2, ci: 0, value: 50 },
        { ri: 3, ci: 0, value: 11 },
      ],
    });
  });

  it('the same gap: the fit counts VISIBLE rows, not raw indices', () => {
    // rowIndex has only 3 visible entries — a 4-row block does not fit,
    // even though the raw index reaches 3 (0..3 would be 4 raw positions).
    expect(planPaste(input({
      grid: [['5'], ['50'], ['11'], ['9']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0, 2, 3],
    }))).toEqual({
      ok: false, reason: 'does-not-fit',
      needRows: 4, needCols: 1, haveRows: 3, haveCols: 2,
    });
  });

  it('an anchor whose row is not visible at all yields no-anchor', () => {
    // ri: 1 does not occur in rowIndex [0, 2, 3] — the row is hidden.
    expect(planPaste(input({ anchor: { ri: 1, ci: 0 }, rowIndex: [0, 2, 3] })))
      .toEqual({ ok: false, reason: 'no-anchor' });
  });

  it('a gap in colIndex is skipped the same way when mapping', () => {
    // colIndex [0, 2]: the column with raw index 1 is hidden.
    expect(planPaste(input({
      grid: [['1', '2']],
      anchor: { ri: 0, ci: 0 },
      colIndex: [0, 2],
    }))).toEqual({
      ok: true,
      targets: [
        { ri: 0, ci: 0, value: 1 },
        { ri: 0, ci: 2, value: 2 },
      ],
    });
  });
});

describe('planPaste on string cells', () => {
  // Reported 2026-09-23: "01223" pasted into a string cell arrived as 1223.
  it('keeps leading zeros and number-looking text as a string', () => {
    const plan = planPaste(input({
      grid: [['01223'], ['02311'], ['1.234,5']],
      commaDecimal: true,
      cellFlags: { '0,0': { s: 1 }, '1,0': { s: 1 }, '2,0': { s: 1 } },
    }));
    expect(plan.ok && plan.targets.map(t => t.value)).toEqual(['01223', '02311', '1.234,5']);
  });

  it('still turns text into numbers on numeric cells', () => {
    const plan = planPaste(input({ grid: [['01223']] }));
    expect(plan.ok && plan.targets[0].value).toBe(1223);
  });
});
