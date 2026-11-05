import { describe, it, expect } from 'vitest';

import { parsePicklistRules } from '../../cubeViewer/picklistRulePure';

/**
 * Task 15: the affected elements come from the control cube's RULE TEXT,
 * not from a cell query. Measured 2026-08-13 (11.8): the rule text costs
 * 1 ms, 417 cells in ONE cellset 12.5 s, the window of a real view
 * > 10 min. The parser is therefore the only area-wide source — and it may
 * only take what it REALLY understands: a wrong arrow is worse
 * than no arrow (the cell keeps working without an arrow, via the
 * single query on double-click).
 */
describe('parsePicklistRules — the simple form', () => {
  it('reads an assignment', () => {
    expect(parsePicklistRules(
      "['Status_Maintenance'] = S: 'Dimension:Dropdown_Maintenance_Status';",
    )).toEqual({ Status_Maintenance: 'Dimension:Dropdown_Maintenance_Status' });
  });

  it('skips a bracket with SEVERAL elements — that is an AND, not an OR', () => {
    // `['A','B']` means in TM1: the cells in which one dimension is at A
    // AND another one is at B — a conjunction across dimensions. The
    // map here is dimensionless and cannot represent an AND at all; carrying it
    // as `{A: def, B: def}` would turn it into an OR and put an
    // arrow on every cell with A, even where TM1 enforces nothing (and the
    // paste pre-check would reject values there that TM1 would accept). Such
    // cells keep going through the lazy single query (1–2 ms).
    expect(parsePicklistRules("['A','B'] = S: 'static:x:y';")).toEqual({});
  });

  it('also skips three elements in one bracket', () => {
    expect(parsePicklistRules("['A','B','C'] = S: 'static:x';")).toEqual({});
  });

  it('still takes the next, SINGLE-element statement', () => {
    // What gets skipped is the line, not the rest of the rule text.
    expect(parsePicklistRules("['A','B'] = S: 'static:x';\n['C'] = S: 'static:y';"))
      .toEqual({ C: 'static:y' });
  });

  it('reads several lines', () => {
    const rules = [
      "['A'] = S: 'static:1';",
      "['B'] = S: 'static:2';",
    ].join('\n');
    expect(parsePicklistRules(rules)).toEqual({ A: 'static:1', B: 'static:2' });
  });

  it('skips comment lines', () => {
    const rules = [
      "# ['Kommentiert'] = S: 'static:nein';",
      "['A'] = S: 'static:ja';",
    ].join('\n');
    expect(parsePicklistRules(rules)).toEqual({ A: 'static:ja' });
  });

  it('takes N: just like S:', () => {
    // The type marker says something about the CELL, not about the definition —
    // a picklist definition is always a string literal.
    expect(parsePicklistRules("['A'] = N: 'static:1';")).toEqual({ A: 'static:1' });
  });

  it('also takes the form without a type marker', () => {
    expect(parsePicklistRules("['A'] = 'static:1';")).toEqual({ A: 'static:1' });
  });

  it('reads a doubled quotation mark as a single one', () => {
    // TM1 escapes `'` in the literal by doubling it — both in the element name and
    // in the definition.
    expect(parsePicklistRules("['O''Brien'] = S: 'static:a''b';"))
      .toEqual({ "O'Brien": "static:a'b" });
  });

  it('takes the first assignment when an element occurs twice', () => {
    // TM1 evaluates rules from top to bottom: the FIRST matching
    // statement wins, later ones are dead for the same cell.
    expect(parsePicklistRules("['A'] = S: 'static:erst';\n['A'] = S: 'static:spaeter';"))
      .toEqual({ A: 'static:erst' });
  });
});

describe('parsePicklistRules — everything not understood is skipped, not guessed', () => {
  it('ignores conditions', () => {
    expect(parsePicklistRules(
      "['A'] = S: IF(!Jahr@='2026', 'static:x', 'static:y');",
    )).toEqual({});
  });

  it('ignores DB(...)', () => {
    expect(parsePicklistRules("['A'] = S: DB('Andere', !Dim1, !Dim2);")).toEqual({});
  });

  it('ignores function calls on the right-hand side', () => {
    expect(parsePicklistRules("['A'] = S: ATTRS('Dim', !Dim, 'Picklist');")).toEqual({});
  });

  it('ignores computed areas', () => {
    // A bracket that does not contain exclusively element names in
    // quotation marks — here a dimension reference.
    expect(parsePicklistRules("[{'A'}] = S: 'static:x';")).toEqual({});
    expect(parsePicklistRules("['A', !Jahr] = S: 'static:x';")).toEqual({});
  });

  it('ignores everything from FEEDERS onward', () => {
    const rules = [
      "['A'] = S: 'static:ja';",
      'FEEDERS;',
      "['B'] = S: 'static:nein';",
    ].join('\n');
    expect(parsePicklistRules(rules)).toEqual({ A: 'static:ja' });
  });

  it('ignores SKIPCHECK and other directives', () => {
    const rules = "SKIPCHECK;\nFEEDSTRINGS;\n['A'] = S: 'static:ja';";
    expect(parsePicklistRules(rules)).toEqual({ A: 'static:ja' });
  });

  it('does not wrongly swallow an assignment without a closing semicolon together with the next one', () => {
    // Without separation, `['A'] = S: 'static:1' ['B'] = S: 'static:2';` would be ONE
    // statement not understood — both elements would then remain without an arrow.
    expect(parsePicklistRules("['A'] = S: 'static:1' ['B'] = S: 'static:2';")).toEqual({});
  });

  it('ignores a feeder statement even without a FEEDERS line', () => {
    expect(parsePicklistRules("['A'] => ['B'];")).toEqual({});
  });

  it('returns an empty map for an empty rule text', () => {
    expect(parsePicklistRules('')).toEqual({});
    expect(parsePicklistRules('   \n\n  ')).toEqual({});
  });

  it('returns an empty map for a missing rule text (no control cube)', () => {
    expect(parsePicklistRules(null)).toEqual({});
    expect(parsePicklistRules(undefined)).toEqual({});
  });

  it('ignores an empty definition — empty means no list', () => {
    expect(parsePicklistRules("['A'] = S: '';")).toEqual({});
  });
});
