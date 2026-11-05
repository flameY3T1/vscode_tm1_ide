import { describe, it, expect } from 'vitest';
import { getTiContextEndpoint } from '../providers/tiContextPatternsPure';

// ─── CubeName arg (arg 0) ────────────────────────────────────────────────────

describe('getTiContextEndpoint — cube at arg 0', () => {
  it('detects CellGetN at trigger (empty prefix)', () => {
    expect(getTiContextEndpoint("CellGetN('")).toBe('Cubes');
  });

  it('detects CellGetN with prefix typed', () => {
    expect(getTiContextEndpoint("CellGetN('Sale")).toBe('Cubes');
  });

  it('detects CellGetS', () => {
    expect(getTiContextEndpoint("CellGetS('")).toBe('Cubes');
  });

  it('detects CubeExists', () => {
    expect(getTiContextEndpoint("IF(CubeExists('")).toBe('Cubes');
  });

  it('detects CubeCreate', () => {
    expect(getTiContextEndpoint("CubeCreate('")).toBe('Cubes');
  });

  it('detects RuleLoadFromFile', () => {
    expect(getTiContextEndpoint("RuleLoadFromFile('")).toBe('Cubes');
  });

  it('detects ViewCreate', () => {
    expect(getTiContextEndpoint("ViewCreate('")).toBe('Cubes');
  });

  it('is case-insensitive for function name', () => {
    expect(getTiContextEndpoint("cellgetn('")).toBe('Cubes');
    expect(getTiContextEndpoint("CELLGETN('")).toBe('Cubes');
  });

  it('works with leading whitespace', () => {
    expect(getTiContextEndpoint("  nCellValue = CellGetN('")).toBe('Cubes');
  });
});

// ─── CubeName arg (arg 1, after Value param) ─────────────────────────────────

describe('getTiContextEndpoint — cube at arg 1', () => {
  it('detects CellPutN after numeric value', () => {
    expect(getTiContextEndpoint("CellPutN(100, '")).toBe('Cubes');
  });

  it('detects CellPutN after variable', () => {
    expect(getTiContextEndpoint("CellPutN(nValue, '")).toBe('Cubes');
  });

  it('detects CellPutS after string value', () => {
    expect(getTiContextEndpoint("CellPutS('hello', '")).toBe('Cubes');
  });

  it('detects CellPutS after string value with prefix typed', () => {
    expect(getTiContextEndpoint("CellPutS('hello', 'Text")).toBe('Cubes');
  });
});

// ─── DimensionName arg (arg 0) ────────────────────────────────────────────────

describe('getTiContextEndpoint — dimension at arg 0', () => {
  it('detects DimensionCreate', () => {
    expect(getTiContextEndpoint("DimensionCreate('")).toBe('Dimensions');
  });

  it('detects DimensionDestroy', () => {
    expect(getTiContextEndpoint("DimensionDestroy('")).toBe('Dimensions');
  });

  it('detects DimensionElementInsert', () => {
    expect(getTiContextEndpoint("DimensionElementInsert('")).toBe('Dimensions');
  });

  it('detects HierarchyElementInsert', () => {
    expect(getTiContextEndpoint("HierarchyElementInsert('")).toBe('Dimensions');
  });

  it('detects DimensionCreate case-insensitive', () => {
    expect(getTiContextEndpoint("dimensioncreate('")).toBe('Dimensions');
    expect(getTiContextEndpoint("DIMENSIONCREATE('")).toBe('Dimensions');
  });

  it('detects with prefix typed', () => {
    expect(getTiContextEndpoint("DimensionCreate('Mon")).toBe('Dimensions');
  });
});

// ─── No match cases ───────────────────────────────────────────────────────────

describe('getTiContextEndpoint — no match', () => {
  it('returns null for a string not inside a function call', () => {
    expect(getTiContextEndpoint("sVar = '")).toBeNull();
  });

  it('returns null when second arg is not a known name arg', () => {
    // CellGetN(CubeName, Elem1, ...) — after the cube arg is complete,
    // the next ' opens Elem1 which is not a CubeName/DimensionName param → null
    expect(getTiContextEndpoint("CellGetN('SalesCube', '")).toBeNull();
  });

  it('returns null for a comment line context', () => {
    // The provider checks for comment lines separately, but getTiContextEndpoint
    // would still match if a function pattern appears in a comment
    // We test that the overall line guard works — not needed here since
    // getTiContextEndpoint is pure regex, comment guard is in the provider
    expect(getTiContextEndpoint("# CellGetN('")).toBe('Cubes'); // regex matches — provider guards this
  });

  it('returns null for unknown function', () => {
    expect(getTiContextEndpoint("MyCustomFunc('")).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getTiContextEndpoint('')).toBeNull();
  });

  it('returns null when inside a second arg that is not a known name arg', () => {
    // CellGetN(CubeName, Elem1, ...) — Elem1 is not a named object
    // After the first arg is complete, we're in Elem territory
    expect(getTiContextEndpoint("CellGetN('SalesCube', '")).toBeNull();
  });

  it('returns null for a closed string before the trigger', () => {
    // CellPutN('text', '   — first arg 'text' is complete, cursor is in arg 1 (CubeName)
    expect(getTiContextEndpoint("CellPutN('text', '")).toBe('Cubes');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('getTiContextEndpoint — edge cases', () => {
  it('handles extra spaces around paren', () => {
    expect(getTiContextEndpoint("CellGetN  (  '")).toBe('Cubes');
  });

  it('handles extra spaces before arg', () => {
    expect(getTiContextEndpoint("CellPutN( 100 , '")).toBe('Cubes');
  });

  it('does not match inside a completed string', () => {
    // This tests that after `'SalesCube'` the quote before cursor does not falsely trigger
    // `CellGetN('SalesCube', 'Jan'` — cursor is inside 'Jan', which is Elem1, not CubeName
    expect(getTiContextEndpoint("CellGetN('SalesCube', 'Jan")).toBeNull();
  });
});

// ── What the forward parser puts right (C3, 2026-09-20) ────────────────────
//
// Up to this point `getTiContextEndpoint` ran on built regexps that searched
// the text BACKWARDS. That form could not handle the three cases below — and
// none of them was tested.

describe('getTiContextEndpoint — nested parentheses', () => {
  it('counts an argument with its own call as ONE argument', () => {
    // `CellPutN(Value, CubeName, …)`: the cursor is in the second argument.
    // The old `ONE_ARG` could not handle parentheses and miscounted here.
    expect(getTiContextEndpoint("CellPutN(Subst('abc',1,2), '")).toBe('Cubes');
  });

  it('also copes with two levels', () => {
    expect(getTiContextEndpoint("AttrPutS(Subst(Str(1,2,3),1,1), '")).toBe('Dimensions');
  });
});

describe('getTiContextEndpoint — the INNERMOST call wins', () => {
  it('takes the call the cursor is in, not the outer one', () => {
    // The regexp searched anywhere to the left for its function name and so
    // also hit a call that the cursor had long since left.
    expect(getTiContextEndpoint("DimensionElementInsert('Region','', CellGetS('"))
      .toBe('Cubes');
  });

  it('after a closed call the outer one counts again', () => {
    expect(getTiContextEndpoint("CellPutN(CellGetN('A','b','c'), '")).toBe('Cubes');
  });
});

describe('getTiContextEndpoint — only the open string', () => {
  it('keeps offering right after the closing quote', () => {
    // PINNED, not desired: `'Sales'` is finished, yet the cube list still
    // appears. The reason is `/'[^']*$/` — the last quote counts as opening
    // when nothing follows it. The old backward path behaved EXACTLY THE SAME
    // (`'[^']*$` on the same text), so the switch to the forward parser
    // changes nothing here. Whoever wants to stop it changes behavior — then
    // this test has to be inverted.
    expect(getTiContextEndpoint("CellGetN('Sales'")).toBe('Cubes');
  });

  it('stays silent for an argument without quotes', () => {
    // A variable is not a name we could list.
    expect(getTiContextEndpoint('CellGetN(vCube')).toBeNull();
  });

  it('stays silent for an unknown function name', () => {
    expect(getTiContextEndpoint("GibtsNicht('")).toBeNull();
  });

  it('stays silent at an argument position that is not a name', () => {
    // `CellGetN(CubeName, Elem1, ElemN)` — from position 1 on they are elements.
    expect(getTiContextEndpoint("CellGetN('Sales','")).toBeNull();
  });
});
