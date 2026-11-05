import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { findBuiltin, builtinNames } from '../../../tiSimulator/eval/builtins';
import { emptyFixtures, cubeCellKey, attrKey } from '../../../tiSimulator/types';

describe('builtins', () => {
  it('lists all expected builtins', () => {
    const names = builtinNames();
    expect(names).toContain('NumberToString');
    expect(names).toContain('StringToNumber');
    expect(names).toContain('LONG');
    expect(names).toContain('SUBST');
    expect(names).toContain('UPPER');
    expect(names).toContain('LOWER');
    expect(names).toContain('TRIM');
  });

  it('NumberToString stringifies numbers (German locale `,` decimal)', () => {
    // Matches TM1 capture-log output for German-locale servers — diff parity
    // requires the same formatting. Integers unchanged.
    expect(findBuiltin('NumberToString')!.invoke([42])).toBe('42');
    expect(findBuiltin('numbertostring')!.invoke([3.14])).toBe('3,14');
  });

  it('StringToNumber parses', () => {
    expect(findBuiltin('StringToNumber')!.invoke(['42'])).toBe(42);
    expect(findBuiltin('StringToNumber')!.invoke([''])).toBe(0);
  });

  it('StringToNumberEx parses with explicit separators', () => {
    expect(findBuiltin('StringToNumberEx')!.invoke(['1.234,56', ',', '.'])).toBe(1234.56);
    expect(findBuiltin('StringToNumberEx')!.invoke(['-66399,09', ',', ''])).toBe(-66399.09);
    expect(findBuiltin('StringToNumberEx')!.invoke(['x', ',', '.'])).toBe(0);
  });

  it('DELET removes a substring (1-based start + length)', () => {
    expect(findBuiltin('DELET')!.invoke(['abcdef', 2, 3])).toBe('aef');
    expect(findBuiltin('DELET')!.invoke(['abc', 1, 0])).toBe('abc');
  });

  it('CODE returns the ASCII code of the 1-based char (0 out of range)', () => {
    expect(findBuiltin('CODE')!.invoke(['0', 1])).toBe(48);
    expect(findBuiltin('CODE')!.invoke(['ABC', 2])).toBe(66);
    expect(findBuiltin('CODE')!.invoke(['x', 5])).toBe(0);
  });

  it('ROUNDP rounds to n decimals', () => {
    expect(findBuiltin('ROUNDP')!.invoke([1.2345, 2])).toBe(1.23);
    expect(findBuiltin('ROUNDP')!.invoke([1.2355, 2])).toBe(1.24);
    expect(findBuiltin('ROUNDP')!.invoke([1234.5, 0])).toBe(1235);
  });

  it('ROUND takes ONE arg and rounds to the nearest integer', () => {
    // TM1's ROUND is 1-arg (live-verified: a 2-arg call aborts). ROUNDP is the
    // decimal-places variant.
    expect(findBuiltin('ROUND')!.invoke([1.4])).toBe(1);
    expect(findBuiltin('ROUND')!.invoke([1.6])).toBe(2);
    expect(findBuiltin('ROUND')!.invoke([-1.6])).toBe(-2);
    expect(() => findBuiltin('ROUND')!.invoke([1.5, 2])).toThrow();
  });

  it('no-op builtins resolve (LogOutput/Sleep/globals/sandbox/CellIsUpdateable)', () => {
    // Registered so processes using them run to completion without warnings.
    expect(findBuiltin('LogOutput')!.invoke(['INFO', 'msg'])).toBe(1);
    expect(findBuiltin('Sleep')!.invoke([100])).toBe(1);
    expect(findBuiltin('StringGlobalVariable')!.invoke(['sVar'])).toBe(1);
    expect(findBuiltin('CubeSetLogChanges')!.invoke(['Cube', 0])).toBe(1);
    expect(findBuiltin('ServerSandboxExists')!.invoke(['base'])).toBe(0);
    expect(findBuiltin('CellIsUpdateable')!.invoke(['Cube', 'e1', 'e2'])).toBe(1);
  });

  it('NUMBR parses string→number (legacy alias; missing → dropped name prefixes)', () => {
    // Regression: NUMBR was absent, so `'VD' | NumberToString(NUMBR(psYear)-1)`
    // threw and the assignment was skipped, dropping the computed element prefix.
    expect(findBuiltin('NUMBR')!.invoke(['2025'])).toBe(2025);
    expect(findBuiltin('numbr')!.invoke(['abc'])).toBe(0);
    expect(findBuiltin('NUMBR')!.invoke([''])).toBe(0);
  });

  it('TimSt drops the dangling trailing backslash (\\Y\\m\\d\\ → YYYYMMDD, no trailing \\)', () => {
    // Regression: `TIMST(NOW(), '\Y\m\d\')` → the trailing `\` was emitted
    // literally as `20260712\`, corrupting `…RL_' | sTimestamp | '.txt'` into
    // `…20260712\.txt` (and basename-normalized to just `.txt` in the diff).
    const out = findBuiltin('TimSt')!.invoke([0, '\\Y\\m\\d\\']) as string;
    expect(out).not.toMatch(/\\/);
    expect(out).toMatch(/^\d{8}$/);
  });

  it('Now/Today/TimSt resolve to fixtures.now (deterministic capture-time replay)', () => {
    // So a `TIMST(NOW())` timestamp baked into a filename reproduces the captured
    // one on ANY replay day, not the current date.
    const fx = emptyFixtures();
    fx.now = new Date('2026-07-12T12:00:00Z');
    expect(findBuiltin('TimSt')!.invoke([0, '\\Y\\m\\d'], fx)).toBe('20260712');
    expect(findBuiltin('Now')!.invoke([], fx)).toBeCloseTo(24299.5, 5); // 2026-07-12 12:00 UTC
  });

  it('GetProcessName returns the process name from fixtures (empty without it)', () => {
    // Regression: was a `() => ''` stub, so `"EXP_" | GetProcessName()` collapsed
    // to `"EXP_"` in the simulator and every view/subset name diffed vs the live
    // capture. Now resolves via fixtures.processName (the original process name).
    const fx = emptyFixtures();
    fx.processName = 'Export_Sample_Process';
    expect(findBuiltin('GetProcessName')!.invoke([], fx)).toBe('Export_Sample_Process');
    expect(findBuiltin('GetProcessName')!.invoke([], emptyFixtures())).toBe('');
    expect(findBuiltin('GetProcessName')!.invoke([])).toBe('');
  });

  it('LONG returns string length', () => {
    expect(findBuiltin('LONG')!.invoke(['hello'])).toBe(5);
    expect(findBuiltin('LONG')!.invoke([''])).toBe(0);
  });

  it('SUBST is 1-indexed', () => {
    expect(findBuiltin('SUBST')!.invoke(['hello', 1, 3])).toBe('hel');
    expect(findBuiltin('SUBST')!.invoke(['hello', 2, 3])).toBe('ell');
  });

  it('UPPER + LOWER + TRIM', () => {
    expect(findBuiltin('UPPER')!.invoke(['abc'])).toBe('ABC');
    expect(findBuiltin('LOWER')!.invoke(['ABC'])).toBe('abc');
    expect(findBuiltin('TRIM')!.invoke(['  x  '])).toBe('x');
  });

  it('throws on wrong arity', () => {
    expect(() => findBuiltin('NumberToString')!.invoke([])).toThrow();
    expect(() => findBuiltin('SUBST')!.invoke(['a', 1])).toThrow();
  });

  it('case-insensitive lookup', () => {
    expect(findBuiltin('NUMBERTOSTRING')).toBeDefined();
    expect(findBuiltin('numbertostring')).toBeDefined();
  });

  it('returns undefined for unknown', () => {
    expect(findBuiltin('Foo')).toBeUndefined();
  });

  it('Scan returns 1-based index of first occurrence (0 if absent)', () => {
    expect(findBuiltin('Scan')!.invoke(['.', 'file.txt'])).toBe(5);
    expect(findBuiltin('Scan')!.invoke(['z', 'file.txt'])).toBe(0);
    expect(findBuiltin('Scan')!.invoke(['', 'file.txt'])).toBe(0);
  });

  it('FileExists always returns 1 (simulator stub)', () => {
    expect(findBuiltin('FileExists')!.invoke(['c:\\foo'])).toBe(1);
  });

  it('GetProcessErrorFileDirectory returns empty string', () => {
    expect(findBuiltin('GetProcessErrorFileDirectory')!.invoke([])).toBe('');
  });

  it('GetProcessName returns empty string (simulator has no process name)', () => {
    expect(findBuiltin('GetProcessName')!.invoke([])).toBe('');
  });

  it('TM1User returns empty string', () => {
    expect(findBuiltin('TM1User')!.invoke([])).toBe('');
  });

  it('INT truncates toward zero', () => {
    expect(findBuiltin('INT')!.invoke([3.7])).toBe(3);
    expect(findBuiltin('INT')!.invoke([-3.7])).toBe(-3);
  });

  it('RAND returns a number in [0,1)', () => {
    const v = findBuiltin('RAND')!.invoke([]) as number;
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('TimSt formats current time via format string', () => {
    const out = findBuiltin('TimSt')!.invoke([0.5, '\\Y\\m\\d']) as string;
    expect(out).toMatch(/^\d{8}$/);
  });

  it('CubeExists returns 1 when cubeDims has cube, else 0', () => {
    const fx = {
      dimensions: new Map(), cubeCells: new Map(), subsets: new Map(),
      subsetProps: new Map(), views: new Map(), attributes: new Map(),
      cubeDims: new Map<string, string[]>([['Plan', ['Time']]]),
    } as any;
    expect(findBuiltin('CubeExists')!.invoke(['Plan'], fx)).toBe(1);
    expect(findBuiltin('CubeExists')!.invoke(['Missing'], fx)).toBe(0);
  });

  it('Mod returns remainder', () => {
    expect(findBuiltin('Mod')!.invoke([7, 2])).toBe(1);
    expect(findBuiltin('Mod')!.invoke([6, 3])).toBe(0);
  });

  it('NumberToStringEx formats with custom separators', () => {
    expect(findBuiltin('NumberToStringEx')!.invoke([21, '#', '.', ''])).toBe('21');
    expect(findBuiltin('NumberToStringEx')!.invoke([1234.5, '#', ',', '.'])).toBe('1.234,5');
    expect(findBuiltin('NumberToStringEx')!.invoke([0.95, '#', '.', ''])).toBe('0.95');
    expect(findBuiltin('NumberToStringEx')!.invoke([-1234, '#', '.', ','])).toBe('-1,234');
  });

  it('NumberToStringEx rounds to the mask decimal count (drops float artifacts)', () => {
    // Regression: `NumberToStringEx(NValue, '#,0.###', ',', '')` leaked JS float
    // noise (`99526,660000001`) vs TM1's 3-decimal `99526,66`. `#` = optional
    // (trailing zeros dropped), `0` = required, count after '.' = max decimals.
    const f = (v: number, m: string, d: string, t: string) =>
      findBuiltin('NumberToStringEx')!.invoke([v, m, d, t]);
    // Computed (not a literal) so the float carries the artifact `.toString()`
    // would expose (99526.660000001) — the exact case that used to leak.
    expect(f(99526.66 + 1e-9, '#,0.###', ',', '')).toBe('99526,66');
    expect(f(-393201.14 - 1e-9, '#,0.###', ',', '')).toBe('-393201,14');
    expect(f(1234.5, '#,##0.00', '.', ',')).toBe('1,234.50');
    expect(f(1000, '#,0', '.', ',')).toBe('1,000');
  });

  it('Fill repeats char n times', () => {
    expect(findBuiltin('Fill')!.invoke(['0', 5])).toBe('00000');
    expect(findBuiltin('Fill')!.invoke(['xy', 3])).toBe('xyxyxy');
    expect(findBuiltin('Fill')!.invoke(['0', 0])).toBe('');
  });

  it('IF ternary picks branch by condition', () => {
    expect(findBuiltin('IF')!.invoke([1, 'a', 'b'])).toBe('a');
    expect(findBuiltin('IF')!.invoke([0, 'a', 'b'])).toBe('b');
  });

  it('ElementCount aliases DIMSIZ', () => {
    const fx = {
      dimensions: new Map([['Time', [{ name: 'Jan', level: 0 }, { name: 'Feb', level: 0 }]]]),
      cubeCells: new Map(), subsets: new Map(), subsetProps: new Map(),
      views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(findBuiltin('ElementCount')!.invoke(['Time'], fx)).toBe(2);
  });

  it('CubeDimensionCountGet returns dim count', () => {
    const fx = {
      dimensions: new Map(), cubeCells: new Map(), subsets: new Map(),
      subsetProps: new Map(), views: new Map(), attributes: new Map(),
      cubeDims: new Map([['Plan', ['A', 'B', 'C']]]),
    } as any;
    expect(findBuiltin('CubeDimensionCountGet')!.invoke(['Plan'], fx)).toBe(3);
    expect(findBuiltin('CubeDimensionCountGet')!.invoke(['Other'], fx)).toBe(0);
  });

  it('ElIsAnc walks Components tree transitively', () => {
    const fx = {
      dimensions: new Map([['Time', [
        { name: 'FY', level: 2, children: ['Q1', 'Q2'] },
        { name: 'Q1', level: 1, children: ['Jan', 'Feb', 'Mar'] },
        { name: 'Q2', level: 1, children: ['Apr', 'May', 'Jun'] },
        { name: 'Jan', level: 0 }, { name: 'Feb', level: 0 }, { name: 'Mar', level: 0 },
        { name: 'Apr', level: 0 }, { name: 'May', level: 0 }, { name: 'Jun', level: 0 },
      ]]]),
      cubeCells: new Map(), subsets: new Map(), subsetProps: new Map(),
      views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'FY', 'Jan'], fx)).toBe(1);
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'Q1', 'Mar'], fx)).toBe(1);
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'Q1', 'Apr'], fx)).toBe(0);
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'FY', 'FY'], fx)).toBe(0);
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'Missing', 'Jan'], fx)).toBe(0);
  });

  it('ElIsAnc case-insensitive', () => {
    const fx = {
      dimensions: new Map([['Time', [
        { name: 'FY', level: 1, children: ['Jan'] },
        { name: 'Jan', level: 0 },
      ]]]),
      cubeCells: new Map(), subsets: new Map(), subsetProps: new Map(),
      views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(findBuiltin('ElIsAnc')!.invoke(['Time', 'fy', 'JAN'], fx)).toBe(1);
  });

  it('DimensionElementPrincipalName returns canonical name from dim', () => {
    const fx = {
      dimensions: new Map([['Time', [{ name: 'Jan', level: 0 }]]]),
      cubeCells: new Map(), subsets: new Map(), subsetProps: new Map(),
      views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(findBuiltin('DimensionElementPrincipalName')!.invoke(['Time', 'jan'], fx)).toBe('Jan');
    expect(findBuiltin('DimensionElementPrincipalName')!.invoke(['Time', 'Missing'], fx)).toBe('Missing');
  });

  it('ViewCreate accepts optional 3rd Private flag', () => {
    const fx = {
      dimensions: new Map(), cubeCells: new Map(), subsets: new Map(),
      subsetProps: new Map(), views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(() => findBuiltin('ViewCreate')!.invoke(['Cube', 'View', 1], fx)).not.toThrow();
    expect(() => findBuiltin('ViewCreate')!.invoke(['Cube', 'View'], fx)).not.toThrow();
    expect(() => findBuiltin('ViewCreate')!.invoke(['Cube'], fx)).toThrow();
  });

  it('unary math builtins compute finite results exactly (no regression)', () => {
    expect(findBuiltin('SQRT')!.invoke([9])).toBe(3);
    expect(findBuiltin('LOG')!.invoke([100])).toBe(2);
    expect(findBuiltin('LN')!.invoke([1])).toBe(0);
    expect(findBuiltin('SIGN')!.invoke([-3])).toBe(-1);
    expect(findBuiltin('ABS')!.invoke([-4])).toBe(4);
  });

  it('unary math builtins return 0 on invalid domain instead of leaking NaN/Infinity', () => {
    // Guard: NaN/±Infinity must never flow into the Value type (would surface as
    // garbage in string concat / TextOutput / diffs). Sim-safe 0 fallback.
    expect(findBuiltin('SQRT')!.invoke([-4])).toBe(0); // Math.sqrt(-4) = NaN
    expect(findBuiltin('LN')!.invoke([0])).toBe(0); // Math.log(0) = -Infinity
    expect(findBuiltin('LOG')!.invoke([0])).toBe(0); // Math.log10(0) = -Infinity
    expect(findBuiltin('LN')!.invoke([-1])).toBe(0); // Math.log(-1) = NaN
    expect(findBuiltin('ACOS')!.invoke([2])).toBe(0); // Math.acos(2) = NaN
    expect(findBuiltin('ASIN')!.invoke([2])).toBe(0); // Math.asin(2) = NaN
  });

  it('TabDim returns nth dimension name (1-based), empty when out of range', () => {
    const fx = {
      ...({ dimensions: new Map(), cubeCells: new Map(), subsets: new Map(),
            subsetProps: new Map(), views: new Map(), attributes: new Map() } as any),
      cubeDims: new Map<string, string[]>([
        ['Plan', ['Time', 'Version', 'Account']],
      ]),
    };
    expect(findBuiltin('TabDim')!.invoke(['Plan', 1], fx)).toBe('Time');
    expect(findBuiltin('TabDim')!.invoke(['Plan', 3], fx)).toBe('Account');
    expect(findBuiltin('TabDim')!.invoke(['Plan', 4], fx)).toBe('');
    expect(findBuiltin('TabDim')!.invoke(['Unknown', 1], fx)).toBe('');
  });
});

describe('cell-read fixture misses (FINDING #5 diagnostics)', () => {
  // Fixtures carrying an empty miss-sink Set — cube reads record uncaptured
  // coords here so the runner can surface ONE aggregated warning.
  const fxWithMiss = () =>
    ({
      dimensions: new Map(),
      cubeCells: new Map(),
      subsets: new Map(),
      subsetProps: new Map(),
      views: new Map(),
      attributes: new Map(),
      cubeDims: new Map(),
      cellReadMisses: new Set<string>(),
    }) as any;

  it('CellGetN on an uncaptured coord records a miss + still returns 0', () => {
    const fx = fxWithMiss();
    expect(findBuiltin('CellGetN')!.invoke(['Plan', 'Jan', 'Actual'], fx)).toBe(0);
    expect(fx.cellReadMisses.has(cubeCellKey('Plan', ['Jan', 'Actual']))).toBe(true);
    expect(fx.cellReadMisses.size).toBe(1);
  });

  it('CellGetS on an uncaptured coord records a miss + still returns empty', () => {
    const fx = fxWithMiss();
    expect(findBuiltin('CellGetS')!.invoke(['Plan', 'Jan', 'Note'], fx)).toBe('');
    expect(fx.cellReadMisses.has(cubeCellKey('Plan', ['Jan', 'Note']))).toBe(true);
    expect(fx.cellReadMisses.size).toBe(1);
  });

  it('a HIT does NOT record a miss', () => {
    const fx = fxWithMiss();
    fx.cubeCells.set(cubeCellKey('Plan', ['Jan', 'Actual']), 5);
    expect(findBuiltin('CellGetN')!.invoke(['Plan', 'Jan', 'Actual'], fx)).toBe(5);
    expect(fx.cellReadMisses.size).toBe(0);
  });

  it('CellIsUndefined does NOT record a miss (Map.has() miss is the correct answer)', () => {
    const fx = fxWithMiss();
    expect(findBuiltin('CellIsUndefined')!.invoke(['Plan', 'Jan', 'Actual'], fx)).toBe(1);
    expect(fx.cellReadMisses.size).toBe(0);
  });

  it('no miss-sink present → read still resolves to fallback without throwing', () => {
    const fx = {
      dimensions: new Map(), cubeCells: new Map(), subsets: new Map(),
      subsetProps: new Map(), views: new Map(), attributes: new Map(), cubeDims: new Map(),
    } as any;
    expect(findBuiltin('CellGetN')!.invoke(['Plan', 'Jan'], fx)).toBe(0);
  });
});

describe('date builtins', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-09T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('Today() returns YYYY-MM-DD string', () => {
    expect(findBuiltin('Today')!.invoke([])).toBe('2026-05-09');
  });

  it('Today(1) also returns formatted string', () => {
    expect(findBuiltin('Today')!.invoke([1])).toBe('2026-05-09');
  });

  it('Now() returns the full TM1 serial: days since 1960 plus the day fraction', () => {
    const v = findBuiltin('Now')!.invoke([]);
    expect(typeof v).toBe('number');
    expect(v as number).toBeGreaterThan(24000); // 2025-09
  });

  it('DAY MONTH YEAR extract from YYYY-MM-DD', () => {
    expect(findBuiltin('DAY')!.invoke(['2026-05-09'])).toBe(9);
    expect(findBuiltin('MONTH')!.invoke(['2026-05-09'])).toBe(5);
    expect(findBuiltin('YEAR')!.invoke(['2026-05-09'])).toBe(2026);
  });

  it('DAY MONTH YEAR accept slash format', () => {
    expect(findBuiltin('DAY')!.invoke(['2026/05/09'])).toBe(9);
  });

  it('DAYNO converts YYYY-MM-DD to serial; consecutive days differ by 1', () => {
    const a = findBuiltin('DAYNO')!.invoke(['2026-05-09']) as number;
    const b = findBuiltin('DAYNO')!.invoke(['2026-05-10']) as number;
    expect(b - a).toBe(1);
  });

  it('AddMonths shifts date forward + cross-year', () => {
    expect(findBuiltin('AddMonths')!.invoke(['2026-01-15', 3])).toBe('2026-04-15');
    expect(findBuiltin('AddMonths')!.invoke(['2026-11-15', 3])).toBe('2027-02-15');
  });

  it('AddMonths handles negative shift', () => {
    expect(findBuiltin('AddMonths')!.invoke(['2026-03-15', -3])).toBe('2025-12-15');
  });

  it('AddMonths clamps day-of-month at month boundary', () => {
    expect(findBuiltin('AddMonths')!.invoke(['2026-01-31', 1])).toBe('2026-02-28');
  });
});

describe('subset builtins', () => {
  function fx() {
    return {
      ...emptyFixtures(),
      subsets: new Map<string, string[]>(),
    };
  }

  it('SubsetCreate + SubsetExists', () => {
    const f = fx();
    // SubsetCreate(DimName, SubsetName) and SubsetExists(DimName, SubsetName) — dim-first (IBM)
    expect(findBuiltin('SubsetExists')!.invoke(['Time', 's1'], f)).toBe(0);
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    expect(findBuiltin('SubsetExists')!.invoke(['Time', 's1'], f)).toBe(1);
  });

  it('SubsetElementInsert appends + size + name', () => {
    const f = fx();
    // SubsetCreate/GetSize/GetElementName/ElementInsert: all dim-first (DimName, SubsetName, ...)
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Jan', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Feb', 0], f);
    expect(findBuiltin('SubsetGetSize')!.invoke(['Time', 's1'], f)).toBe(2);
    expect(findBuiltin('SubsetGetElementName')!.invoke(['Time', 's1', 1], f)).toBe('Jan');
    expect(findBuiltin('SubsetGetElementName')!.invoke(['Time', 's1', 2], f)).toBe('Feb');
  });

  it('SubsetElementInsert at position', () => {
    const f = fx();
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Jan', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Mar', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Feb', 2], f);
    expect(findBuiltin('SubsetGetElementName')!.invoke(['Time', 's1', 2], f)).toBe('Feb');
  });

  it('SubsetElementDelete by index', () => {
    const f = fx();
    // SubsetElementDelete(DimName, SubsetName, Index) — dim-first (IBM)
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Jan', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Feb', 0], f);
    findBuiltin('SubsetElementDelete')!.invoke(['Time', 's1', 1], f);
    expect(findBuiltin('SubsetGetSize')!.invoke(['Time', 's1'], f)).toBe(1);
    expect(findBuiltin('SubsetGetElementName')!.invoke(['Time', 's1', 1], f)).toBe('Feb');
  });

  it('SubsetDeleteAllElements clears but keeps subset', () => {
    const f = fx();
    // SubsetDeleteAllElements(DimName, SubsetName) — dim-first
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    findBuiltin('SubsetElementInsert')!.invoke(['Time', 's1', 'Jan', 0], f);
    findBuiltin('SubsetDeleteAllElements')!.invoke(['Time', 's1'], f);
    expect(findBuiltin('SubsetGetSize')!.invoke(['Time', 's1'], f)).toBe(0);
    expect(findBuiltin('SubsetExists')!.invoke(['Time', 's1'], f)).toBe(1);
  });

  it('SubsetDestroy removes subset', () => {
    const f = fx();
    // SubsetCreate(DimName, SubsetName) and SubsetDestroy(DimName, SubsetName) — both dim-first
    findBuiltin('SubsetCreate')!.invoke(['Time', 's1'], f);
    findBuiltin('SubsetDestroy')!.invoke(['Time', 's1'], f);
    expect(findBuiltin('SubsetExists')!.invoke(['Time', 's1'], f)).toBe(0);
  });

  // Interop: Create/Exists/Destroy are all dim-first and must share the canonical (dim,sub) key
  it('cross-family interop: SubsetCreate + SubsetExists + SubsetDestroy', () => {
    const f = fx();
    // SubsetCreate(DimName, SubsetName) — dim-first (IBM)
    findBuiltin('SubsetCreate')!.invoke(['MyDim', 's'], f);
    expect(findBuiltin('SubsetExists')!.invoke(['MyDim', 's'], f)).toBe(1);
    // SubsetDestroy(DimName, SubsetName) — dim-first; must hit the same canonical key
    findBuiltin('SubsetDestroy')!.invoke(['MyDim', 's'], f);
    expect(findBuiltin('SubsetExists')!.invoke(['MyDim', 's'], f)).toBe(0);
  });

  // SubsetGetSize reads from a subset built via dim-first SubsetElementInsert
  it('SubsetGetSize reads canonically-keyed subset', () => {
    const f = fx();
    // SubsetElementInsert(DimName, SubName, ...) — dim-first, already canonical
    findBuiltin('SubsetElementInsert')!.invoke(['MyDim', 's', 'Jan', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['MyDim', 's', 'Feb', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['MyDim', 's', 'Mar', 0], f);
    // SubsetGetSize(DimName, SubsetName) — dim-first; must resolve same canonical key
    expect(findBuiltin('SubsetGetSize')!.invoke(['MyDim', 's'], f)).toBe(3);
  });

  // SubsetGetElementName reads from a subset built via dim-first SubsetElementInsert
  it('SubsetGetElementName reads canonically-keyed subset', () => {
    const f = fx();
    findBuiltin('SubsetElementInsert')!.invoke(['MyDim', 's', 'Jan', 0], f);
    findBuiltin('SubsetElementInsert')!.invoke(['MyDim', 's', 'Feb', 0], f);
    // SubsetGetElementName(DimName, SubsetName, Index) — dim-first (IBM)
    expect(findBuiltin('SubsetGetElementName')!.invoke(['MyDim', 's', 1], f)).toBe('Jan');
    expect(findBuiltin('SubsetGetElementName')!.invoke(['MyDim', 's', 2], f)).toBe('Feb');
  });
});

describe('dim-creation builtins', () => {
  function fx() {
    return emptyFixtures();
  }

  it('DimensionCreate + DimensionExists', () => {
    const f = fx();
    expect(findBuiltin('DimensionExists')!.invoke(['D'], f)).toBe(0);
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    expect(findBuiltin('DimensionExists')!.invoke(['D'], f)).toBe(1);
  });

  it('DimensionElementInsert append + after', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Jan', 'N'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Mar', 'N'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', 'Jan', 'Feb', 'N'], f);
    expect(findBuiltin('DIMSIZ')!.invoke(['D'], f)).toBe(3);
    expect(findBuiltin('DIMNM')!.invoke(['D', 1], f)).toBe('Jan');
    expect(findBuiltin('DIMNM')!.invoke(['D', 2], f)).toBe('Feb');
    expect(findBuiltin('DIMNM')!.invoke(['D', 3], f)).toBe('Mar');
  });

  it('Consolidation type sets level=1', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Total', 'C'], f);
    expect(findBuiltin('ELLEV')!.invoke(['D', 'Total'], f)).toBe(1);
  });

  it('DimensionElementDelete removes element', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Jan', 'N'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Feb', 'N'], f);
    findBuiltin('DimensionElementDelete')!.invoke(['D', 'Jan'], f);
    expect(findBuiltin('DIMSIZ')!.invoke(['D'], f)).toBe(1);
    expect(findBuiltin('DIMIX')!.invoke(['D', 'Jan'], f)).toBe(0);
  });

  it('DimensionElementComponentAdd promotes parent level', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Total', 'N'], f);
    findBuiltin('DimensionElementInsert')!.invoke(['D', '', 'Jan', 'N'], f);
    findBuiltin('DimensionElementComponentAdd')!.invoke(['D', 'Total', 'Jan', 1], f);
    expect(findBuiltin('ELLEV')!.invoke(['D', 'Total'], f)).toBe(1);
  });

  it('DimensionDestroy removes dimension', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('DimensionDestroy')!.invoke(['D'], f);
    expect(findBuiltin('DimensionExists')!.invoke(['D'], f)).toBe(0);
  });

  it('HierarchyElementInsert behaves like DimensionElementInsert', () => {
    const f = fx();
    findBuiltin('DimensionCreate')!.invoke(['D'], f);
    findBuiltin('HierarchyElementInsert')!.invoke(['D', 'D', '', 'A', 'N'], f);
    findBuiltin('HierarchyElementInsert')!.invoke(['D', 'D', 'A', 'B', 'C'], f);
    expect(findBuiltin('DIMSIZ')!.invoke(['D'], f)).toBe(2);
    expect(findBuiltin('ELLEV')!.invoke(['D', 'B'], f)).toBe(1);
  });
});

describe('attribute builtins', () => {
  function fx() {
    return emptyFixtures();
  }

  // The hierarchy in the third slot is mandatory (live 11.8, 2026-08-12): the
  // four-argument form without it does not compile on the server.
  it('ElementAttrPutN + ElementAttrGetN round-trip', () => {
    const f = fx();
    findBuiltin('ElementAttrPutN')!.invoke([42, 'D', 'D', 'Jan', 'Sequence'], f);
    expect(findBuiltin('ElementAttrGetN')!.invoke(['D', 'Jan', 'Sequence'], f)).toBe(42);
  });

  it('ElementAttrPutS + ElementAttrGetS round-trip', () => {
    const f = fx();
    findBuiltin('ElementAttrPutS')!.invoke(['January', 'D', 'D', 'Jan', 'Caption'], f);
    expect(findBuiltin('ElementAttrGetS')!.invoke(['D', 'Jan', 'Caption'], f)).toBe('January');
  });

  it('AttrGet on missing returns 0 / empty', () => {
    const f = fx();
    expect(findBuiltin('ElementAttrGetN')!.invoke(['D', 'Jan', 'X'], f)).toBe(0);
    expect(findBuiltin('ElementAttrGetS')!.invoke(['D', 'Jan', 'X'], f)).toBe('');
  });

  it('Attr lookup is case-insensitive on dim/elem/attr names', () => {
    const f = fx();
    findBuiltin('ElementAttrPutS')!.invoke(['x', 'D', 'D', 'Jan', 'Caption'], f);
    expect(findBuiltin('ElementAttrGetS')!.invoke(['d', 'JAN', 'caption'], f)).toBe('x');
  });

  it('AttrPut* / AttrGet* synonyms behave the same', () => {
    const f = fx();
    findBuiltin('AttrPutN')!.invoke([7, 'D', 'Jan', 'X'], f);
    expect(findBuiltin('AttrGetN')!.invoke(['D', 'Jan', 'X'], f)).toBe(7);
  });

  it('AttrInsert is a no-op returning 1', () => {
    const f = fx();
    expect(findBuiltin('AttrInsert')!.invoke(['D', '', 'X', 'S'], f)).toBe(1);
  });

  it('AttrDelete clears stored values for (dim, *, attr)', () => {
    const f = fx();
    findBuiltin('AttrPutS')!.invoke(['v', 'D', 'Jan', 'Code'], f);
    findBuiltin('AttrPutS')!.invoke(['v', 'D', 'Feb', 'Code'], f);
    findBuiltin('AttrPutS')!.invoke(['x', 'D', 'Jan', 'Other'], f);
    expect(findBuiltin('AttrDelete')!.invoke(['D', 'Code'], f)).toBe(1);
    expect(findBuiltin('AttrGetS')!.invoke(['D', 'Jan', 'Code'], f)).toBe('');
    expect(findBuiltin('AttrGetS')!.invoke(['D', 'Feb', 'Code'], f)).toBe('');
    expect(findBuiltin('AttrGetS')!.invoke(['D', 'Jan', 'Other'], f)).toBe('x');
  });

  it('ElementAttrInsert / ElementAttrDelete are no-ops returning 1', () => {
    const f = fx();
    expect(findBuiltin('ElementAttrInsert')!.invoke(['D', 'D', '', 'A', 'S'], f)).toBe(1);
    expect(findBuiltin('ElementAttrDelete')!.invoke(['D', 'D', 'A'], f)).toBe(1);
  });

  it('AttributePut (legacy) writes to attribute store', () => {
    const f = fx();
    findBuiltin('AttributePut')!.invoke(['hello', 'D', 'Jan', 'Caption'], f);
    expect(findBuiltin('AttrGetS')!.invoke(['D', 'Jan', 'Caption'], f)).toBe('hello');
  });
});

describe('hierarchy + element-extras builtins (Phase C)', () => {
  const fx = () => ({
    ...emptyFixtures(),
    dimensions: new Map<string, { name: string; level: number }[]>([
      ['D', [{ name: 'A', level: 0 }, { name: 'B', level: 0 }]],
    ]),
  });

  it('HierarchyDeleteAllElements clears element list', () => {
    const f = fx();
    expect(findBuiltin('HierarchyDeleteAllElements')!.invoke(['D', 'D'], f)).toBe(1);
    expect(f.dimensions.get('D')).toEqual([]);
  });

  it('HierarchyElementDelete removes element by name', () => {
    const f = fx();
    findBuiltin('HierarchyElementDelete')!.invoke(['D', 'D', 'A'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['B']);
  });

  it('DimensionTopElementInsert appends at root', () => {
    const f = fx();
    findBuiltin('DimensionTopElementInsert')!.invoke(['D', 'NewE', 'N'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['A', 'B', 'NewE']);
  });

  it('HierarchyTopElementInsert appends at root in hierarchy', () => {
    const f = fx();
    findBuiltin('HierarchyTopElementInsert')!.invoke(['D', 'D', 0, 'NewE'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['A', 'B', 'NewE']);
  });

  it('ElementInsert (legacy 5-arg) appends element', () => {
    const f = fx();
    findBuiltin('ElementInsert')!.invoke(['D', 'D', '', 'NewE', 1], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['A', 'B', 'NewE']);
  });

  it('ElementDelete (legacy 2-arg) removes by elem-name', () => {
    const f = fx();
    findBuiltin('ElementDelete')!.invoke(['D', 'A'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['B']);
  });

  it('ElementDelete (legacy 3-arg) removes by elem-name (hier ignored)', () => {
    const f = fx();
    findBuiltin('ElementDelete')!.invoke(['D', 'D', 'A'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['B']);
  });

  it('HierarchyCreate / HierarchyDestroy / DimensionHierarchyCreate are no-ops', () => {
    const f = fx();
    expect(findBuiltin('HierarchyCreate')!.invoke(['D', 'H'], f)).toBe(1);
    expect(findBuiltin('HierarchyDestroy')!.invoke(['D', 'H'], f)).toBe(1);
    expect(findBuiltin('DimensionHierarchyCreate')!.invoke(['D', 'H'], f)).toBe(1);
  });
});

describe('schema/lifecycle/security/tran builtins — no-ops returning 1', () => {
  it('Object-type attribute schema mutations are no-ops', () => {
    expect(findBuiltin('CubeAttrInsert')!.invoke(['', 'A', 'S'])).toBe(1);
    expect(findBuiltin('CubeAttrDelete')!.invoke(['A'])).toBe(1);
    expect(findBuiltin('DimensionAttrInsert')!.invoke(['', 'A', 'S'])).toBe(1);
    expect(findBuiltin('ChoreAttrInsert')!.invoke(['', 'A', 'S'])).toBe(1);
    expect(findBuiltin('ViewAttrInsert')!.invoke(['', 'A', 'S'])).toBe(1);
    expect(findBuiltin('SubsetAttrInsert')!.invoke(['', 'A', 'S'])).toBe(1);
    expect(findBuiltin('HierarchySubsetAttrInsert')!.invoke(['D', 'H', 'S', 'A', 'S'])).toBe(1);
  });

  it('Cube + view lifecycle no-ops', () => {
    expect(findBuiltin('CubeDestroy')!.invoke(['C'])).toBe(1);
    expect(findBuiltin('CubeRuleDestroy')!.invoke(['C'])).toBe(1);
    expect(findBuiltin('RuleDestroy')!.invoke(['C'])).toBe(1);
    expect(findBuiltin('ViewCreate')!.invoke(['C', 'V'])).toBe(1);
    expect(findBuiltin('ViewMDXSet')!.invoke(['C', 'V', 'X'])).toBe(1);
    expect(findBuiltin('ViewSuppressZeroesSet')!.invoke(['C', 'V', 1])).toBe(1);
    expect(findBuiltin('ViewExtractSkipCalcsSet')!.invoke(['C', 'V', 1])).toBe(1);
  });

  it('Security + DR + Tran no-ops', () => {
    expect(findBuiltin('CellSecurityCubeCreate')!.invoke(['C'])).toBe(1);
    expect(findBuiltin('CubeDRRelease')!.invoke(['C', 'list'])).toBe(1);
    expect(findBuiltin('HierarchyElementSecurityPut')!.invoke(['Read', 'D', 'H', 'E', 'G'])).toBe(
      1,
    );
    expect(findBuiltin('TranSave')!.invoke(['tx-1'])).toBe(1);
    expect(findBuiltin('TranDelete')!.invoke(['tx-1'])).toBe(1);
  });

  it('SubsetDelete (non-standard spelling of SubsetDestroy, reversed args)', () => {
    const fx = {
      ...emptyFixtures(),
      subsets: new Map<string, string[]>([['D\t\tS', []]]),
    };
    expect(findBuiltin('SubsetDelete')!.invoke(['S', 'D'], fx)).toBe(1);
    expect(fx.subsets.has('D\t\tS')).toBe(false);
  });

  it('Subset MDX/Alias/Flag setters are no-ops', () => {
    expect(findBuiltin('SubsetMDXSet')!.invoke(['D', 'S', 'X'])).toBe(1);
    expect(findBuiltin('SubsetIsAllSet')!.invoke(['D', 'S', 1])).toBe(1);
    expect(findBuiltin('SubsetAliasSet')!.invoke(['D', 'S', 'A'])).toBe(1);
  });

  it('HierarchySubset family no-ops', () => {
    expect(findBuiltin('HierarchySubsetCreate')!.invoke(['D', 'H', 'S'])).toBe(1);
    expect(findBuiltin('HierarchySubsetDestroy')!.invoke(['D', 'H', 'S'])).toBe(1);
    expect(findBuiltin('HierarchySubsetElementInsert')!.invoke(['D', 'H', 'S', 'E', 0])).toBe(1);
    expect(findBuiltin('HierarchySubsetMDXSet')!.invoke(['D', 'H', 'S', 'X'])).toBe(1);
  });

  it('SaveDataAll / CubeSaveData / CubeUnload no-ops', () => {
    expect(findBuiltin('SaveDataAll')!.invoke([])).toBe(1);
    expect(findBuiltin('CubeSaveData')!.invoke(['C'])).toBe(1);
    expect(findBuiltin('CubeUnload')!.invoke(['C'])).toBe(1);
  });
});

describe('Phase D — subset properties (mdx / alias / isAll)', () => {
  const fx = () => ({
    ...emptyFixtures(),
    subsets: new Map<string, string[]>(),
    subsetProps: new Map<string, { mdx?: string; alias?: string; isAll?: boolean }>(),
  });

  it('SubsetMDXSet + SubsetAliasGet store props', () => {
    const f = fx();
    findBuiltin('SubsetCreate')!.invoke(['D', 'S'], f);
    findBuiltin('SubsetMDXSet')!.invoke(['D', 'S', 'SELECT [a]'], f);
    findBuiltin('SubsetAliasSet')!.invoke(['D', 'S', 'AliasA'], f);
    findBuiltin('SubsetIsAllSet')!.invoke(['D', 'S', 1], f);
    expect(findBuiltin('SubsetAliasGet')!.invoke(['D', 'S'], f)).toBe('AliasA');
    const props = f.subsetProps.get('D\t\tS');
    expect(props?.mdx).toBe('SELECT [a]');
    expect(props?.isAll).toBe(true);
  });
});

describe('Phase D — HierarchySubset family (hier-aware state)', () => {
  const fx = () => ({
    ...emptyFixtures(),
    subsets: new Map<string, string[]>(),
  });

  it('Create / Exists / GetSize / GetElementName round-trip with hier', () => {
    const f = fx();
    findBuiltin('HierarchySubsetCreate')!.invoke(['D', 'H', 'S'], f);
    expect(findBuiltin('HierarchySubsetExists')!.invoke(['D', 'H', 'S'], f)).toBe(1);
    expect(findBuiltin('HierarchySubsetExists')!.invoke(['D', 'H2', 'S'], f)).toBe(0);
    findBuiltin('HierarchySubsetElementInsert')!.invoke(['D', 'H', 'S', 'E1', 0], f);
    findBuiltin('HierarchySubsetElementInsert')!.invoke(['D', 'H', 'S', 'E2', 0], f);
    expect(findBuiltin('HierarchySubsetGetSize')!.invoke(['D', 'H', 'S'], f)).toBe(2);
    expect(findBuiltin('HierarchySubsetGetElementName')!.invoke(['D', 'H', 'S', 1], f)).toBe('E1');
    expect(findBuiltin('HierarchySubsetElementExists')!.invoke(['D', 'H', 'S', 'E1'], f)).toBe(1);
    expect(findBuiltin('HierarchySubsetElementGetIndex')!.invoke(['D', 'H', 'S', 'E2'], f)).toBe(2);
  });

  it('default-hier subset (SubsetCreate) collides with HierarchySubsetCreate(dim, "", sub)', () => {
    const f = fx();
    // SubsetCreate(DimName, SubsetName) — dim-first; 'D' is DimName, 'S' is SubName
    findBuiltin('SubsetCreate')!.invoke(['D', 'S'], f);
    expect(findBuiltin('HierarchySubsetExists')!.invoke(['D', '', 'S'], f)).toBe(1);
  });

  it('ElementDelete + DeleteAllElements operate on hier-keyed subset', () => {
    const f = fx();
    findBuiltin('HierarchySubsetCreate')!.invoke(['D', 'H', 'S'], f);
    findBuiltin('HierarchySubsetElementInsert')!.invoke(['D', 'H', 'S', 'E1', 0], f);
    findBuiltin('HierarchySubsetElementInsert')!.invoke(['D', 'H', 'S', 'E2', 0], f);
    findBuiltin('HierarchySubsetElementDelete')!.invoke(['D', 'H', 'S', 'E1'], f);
    expect(findBuiltin('HierarchySubsetGetSize')!.invoke(['D', 'H', 'S'], f)).toBe(1);
    findBuiltin('HierarchySubsetDeleteAllElements')!.invoke(['D', 'H', 'S'], f);
    expect(findBuiltin('HierarchySubsetGetSize')!.invoke(['D', 'H', 'S'], f)).toBe(0);
  });

  it('MDXGet / AliasGet round-trip', () => {
    const f = fx();
    findBuiltin('HierarchySubsetCreate')!.invoke(['D', 'H', 'S'], f);
    findBuiltin('HierarchySubsetMDXSet')!.invoke(['D', 'H', 'S', 'X'], f);
    findBuiltin('HierarchySubsetAliasSet')!.invoke(['D', 'H', 'S', 'A1'], f);
    findBuiltin('HierarchySubsetIsAllSet')!.invoke(['D', 'H', 'S', 1], f);
    expect(findBuiltin('HierarchySubsetMDXGet')!.invoke(['D', 'H', 'S'], f)).toBe('X');
    expect(findBuiltin('HierarchySubsetAliasGet')!.invoke(['D', 'H', 'S'], f)).toBe('A1');
  });

  it('Destroy clears both subset elements and props', () => {
    const f = fx();
    findBuiltin('HierarchySubsetCreate')!.invoke(['D', 'H', 'S'], f);
    findBuiltin('HierarchySubsetMDXSet')!.invoke(['D', 'H', 'S', 'X'], f);
    findBuiltin('HierarchySubsetDestroy')!.invoke(['D', 'H', 'S'], f);
    expect(findBuiltin('HierarchySubsetExists')!.invoke(['D', 'H', 'S'], f)).toBe(0);
    expect(findBuiltin('HierarchySubsetMDXGet')!.invoke(['D', 'H', 'S'], f)).toBe('');
  });
});

describe('Phase D — view state', () => {
  const fx = () => ({
    ...emptyFixtures(),
    subsets: new Map<string, string[]>(),
    views: new Map<string, { cube: string; view: string; mdx?: string; suppressZeroes?: boolean }>(),
  });

  it('ViewCreate / ViewExists / ViewDelete round-trip', () => {
    const f = fx();
    findBuiltin('ViewCreate')!.invoke(['Plan', 'V1'], f);
    expect(findBuiltin('ViewExists')!.invoke(['Plan', 'V1'], f)).toBe(1);
    expect(findBuiltin('ViewExists')!.invoke(['Plan', 'V2'], f)).toBe(0);
    findBuiltin('ViewDelete')!.invoke(['Plan', 'V1'], f);
    expect(findBuiltin('ViewExists')!.invoke(['Plan', 'V1'], f)).toBe(0);
  });

  it('ViewMDXSet stores mdx; ViewSuppressZeroesSet stores flag', () => {
    const f = fx();
    findBuiltin('ViewCreate')!.invoke(['Plan', 'V1'], f);
    findBuiltin('ViewMDXSet')!.invoke(['Plan', 'V1', 'SELECT'], f);
    findBuiltin('ViewSuppressZeroesSet')!.invoke(['Plan', 'V1', 1], f);
    const v = f.views.get('Plan\tV1');
    expect(v?.mdx).toBe('SELECT');
    expect(v?.suppressZeroes).toBe(true);
  });

  it('ViewDestroy removes view', () => {
    const f = fx();
    findBuiltin('ViewCreate')!.invoke(['Plan', 'V1'], f);
    findBuiltin('ViewDestroy')!.invoke(['Plan', 'V1'], f);
    expect(findBuiltin('ViewExists')!.invoke(['Plan', 'V1'], f)).toBe(0);
  });

  it('ViewRow / Column / TitleDimensionSet store positions', () => {
    const f = fx();
    findBuiltin('ViewCreate')!.invoke(['C', 'V'], f);
    findBuiltin('ViewRowDimensionSet')!.invoke(['C', 'V', 'Time', 1], f);
    findBuiltin('ViewColumnDimensionSet')!.invoke(['C', 'V', 'Region', 1], f);
    findBuiltin('ViewTitleDimensionSet')!.invoke(['C', 'V', 'Year', 1], f);
    findBuiltin('ViewTitleElementSet')!.invoke(['C', 'V', 'Year', '2026'], f);
    const v = f.views.get('C\tV') as ViewStateLite;
    expect(v.rowDims?.get(1)).toBe('Time');
    expect(v.columnDims?.get(1)).toBe('Region');
    expect(v.titleDims?.get(1)).toBe('Year');
    expect(v.titleElems?.get('Year')).toBe('2026');
  });

  it('ViewExtractSkip* setters store boolean flags', () => {
    const f = fx();
    findBuiltin('ViewCreate')!.invoke(['C', 'V'], f);
    findBuiltin('ViewExtractSkipCalcsSet')!.invoke(['C', 'V', 1], f);
    findBuiltin('ViewExtractSkipConsolidatedValuesSet')!.invoke(['C', 'V', 0], f);
    findBuiltin('ViewExtractSkipRuleValuesSet')!.invoke(['C', 'V', 1], f);
    findBuiltin('ViewExtractSkipZeroesSet')!.invoke(['C', 'V', 1], f);
    const v = f.views.get('C\tV') as ViewStateLite;
    expect(v.extractSkipCalcs).toBe(true);
    expect(v.extractSkipConsolidatedValues).toBe(false);
    expect(v.extractSkipRuleValues).toBe(true);
    expect(v.extractSkipZeroes).toBe(true);
  });
});

type ViewStateLite = {
  cube: string;
  view: string;
  mdx?: string;
  suppressZeroes?: boolean;
  rowDims?: Map<number, string>;
  columnDims?: Map<number, string>;
  titleDims?: Map<number, string>;
  titleElems?: Map<string, string>;
  extractSkipCalcs?: boolean;
  extractSkipConsolidatedValues?: boolean;
  extractSkipRuleValues?: boolean;
  extractSkipZeroes?: boolean;
};

describe('Phase D — Hierarchy queries (single-hierarchy: dim-backed)', () => {
  const fx = () => ({
    ...emptyFixtures(),
    dimensions: new Map<string, { name: string; level: number }[]>([
      ['D', [{ name: 'A', level: 0 }, { name: 'B', level: 0 }, { name: 'C', level: 1 }]],
    ]),
  });

  it('HierarchyExists matches dim-existence', () => {
    const f = fx();
    expect(findBuiltin('HierarchyExists')!.invoke(['D', 'D'], f)).toBe(1);
    expect(findBuiltin('HierarchyExists')!.invoke(['Missing', 'X'], f)).toBe(0);
  });

  it('HierarchyElementExists matches dim element list', () => {
    const f = fx();
    expect(findBuiltin('HierarchyElementExists')!.invoke(['D', 'D', 'A'], f)).toBe(1);
    expect(findBuiltin('HierarchyElementExists')!.invoke(['D', 'D', 'X'], f)).toBe(0);
  });

  it('HierarchyElementCount returns dim length', () => {
    const f = fx();
    expect(findBuiltin('HierarchyElementCount')!.invoke(['D', 'D'], f)).toBe(3);
  });

  it('HierarchyName returns dim name at index 1, empty otherwise', () => {
    const f = fx();
    expect(findBuiltin('HierarchyName')!.invoke(['D', 1], f)).toBe('D');
    expect(findBuiltin('HierarchyName')!.invoke(['D', 2], f)).toBe('');
  });

  it('HierarchyDeleteElements removes specified elements', () => {
    const f = fx();
    findBuiltin('HierarchyDeleteElements')!.invoke(['D', 'D', 'A', 'C'], f);
    expect(f.dimensions.get('D')!.map((e) => e.name)).toEqual(['B']);
  });

  describe('batch ⑥ write/security/file no-ops', () => {
    it('registers all batch-⑥ builtins (case-insensitive lookup)', () => {
      const names = [
        'ASCIIDelete',
        'RuleLoadFromFile',
        'WildcardFileSearch',
        'CubeClearData',
        'DimensionDeleteAllElements',
        'HierarchySortOrder',
        'ViewCreateByMDX',
        'PublishView',
        'SubsetAttrPutS',
        'SubsetAttrPutN',
        'ViewAttrPutS',
        'ViewAttrPutN',
        'SwapAliasWithPrincipalName',
        'AddClient',
        'AddClientToGroup',
        'AddGroup',
        'AssignClientToGroup',
        'AssignClientPassword',
        'DeleteClient',
        'DeleteGroup',
        'RemoveClientFromGroup',
        'ProcessExitByChoreQuit',
      ];
      for (const n of names) {
        expect(findBuiltin(n), n).toBeDefined();
        expect(findBuiltin(n.toLowerCase()), n).toBeDefined();
      }
    });

    it('void write/security no-ops validate arity and return 1', () => {
      expect(findBuiltin('ASCIIDelete')!.invoke(['f.txt'])).toBe(1);
      expect(findBuiltin('CubeClearData')!.invoke(['Sales'])).toBe(1);
      expect(findBuiltin('DimensionDeleteAllElements')!.invoke(['Time'])).toBe(1);
      expect(
        findBuiltin('HierarchySortOrder')!.invoke(['D', 'D', 'ByName', 'Ascending', 'ByName', 'Ascending']),
      ).toBe(1);
      expect(findBuiltin('ViewCreateByMDX')!.invoke(['C', 'V', 'SELECT ...'])).toBe(1);
      expect(findBuiltin('SubsetAttrPutS')!.invoke(['v', 'D', 'S', 'Caption'])).toBe(1);
      expect(findBuiltin('ViewAttrPutN')!.invoke([1, 'C', 'V', 'attr'])).toBe(1);
      expect(findBuiltin('DeleteClient')!.invoke(['u'])).toBe(1);
      expect(findBuiltin('AddClientToGroup')!.invoke(['u', 'g'])).toBe(1);
      expect(findBuiltin('AssignClientPassword')!.invoke(['u', 'pw'])).toBe(1);
      expect(findBuiltin('ProcessExitByChoreQuit')!.invoke([])).toBe(17);
    });

    it('AddClient accepts optional password (arity 1-2)', () => {
      expect(findBuiltin('AddClient')!.invoke(['u'])).toBe(1);
      expect(findBuiltin('AddClient')!.invoke(['u', 'pw'])).toBe(1);
      expect(() => findBuiltin('AddClient')!.invoke([])).toThrow();
    });

    it('WildcardFileSearch returns empty (no filesystem → loops terminate)', () => {
      expect(findBuiltin('WildcardFileSearch')!.invoke(['*.txt', ''])).toBe('');
      expect(() => findBuiltin('WildcardFileSearch')!.invoke(['*.txt'])).toThrow();
    });

    it('rejects wrong arity', () => {
      expect(() => findBuiltin('DeleteClient')!.invoke([])).toThrow();
      expect(() => findBuiltin('CubeClearData')!.invoke(['a', 'b'])).toThrow();
      expect(() => findBuiltin('ProcessExitByChoreQuit')!.invoke(['x'])).toThrow();
    });
  });

  describe('batch ⑦ common reads: math/trig', () => {
    it('computes pure numeric functions', () => {
      expect(findBuiltin('ABS')!.invoke([-5])).toBe(5);
      expect(findBuiltin('SQRT')!.invoke([9])).toBe(3);
      expect(findBuiltin('EXP')!.invoke([0])).toBe(1);
      expect(findBuiltin('LN')!.invoke([1])).toBe(0);
      expect(findBuiltin('LOG')!.invoke([100])).toBe(2); // base-10
      expect(findBuiltin('SIGN')!.invoke([-3])).toBe(-1);
      expect(findBuiltin('SIGN')!.invoke([0])).toBe(0);
      expect(findBuiltin('SIN')!.invoke([0])).toBe(0);
      expect(findBuiltin('COS')!.invoke([0])).toBe(1);
      expect(findBuiltin('TAN')!.invoke([0])).toBe(0);
      expect(findBuiltin('ASIN')!.invoke([0])).toBe(0);
      expect(findBuiltin('ACOS')!.invoke([1])).toBe(0);
      expect(findBuiltin('ATAN')!.invoke([0])).toBe(0);
    });

    it('coerces string args and rejects wrong arity', () => {
      expect(findBuiltin('ABS')!.invoke(['-7'])).toBe(7);
      expect(() => findBuiltin('ABS')!.invoke([])).toThrow();
      expect(() => findBuiltin('SQRT')!.invoke([1, 2])).toThrow();
    });
  });

  describe('batch ⑦ common reads: string', () => {
    it('LTRIM / RTRIM strip one side only', () => {
      expect(findBuiltin('LTRIM')!.invoke(['  ab '])).toBe('ab ');
      expect(findBuiltin('RTRIM')!.invoke([' ab  '])).toBe(' ab');
    });

    it('INSRT inserts before 1-based position (clamped)', () => {
      expect(findBuiltin('INSRT')!.invoke(['X', 'abc', 2])).toBe('aXbc');
      expect(findBuiltin('INSRT')!.invoke(['X', 'abc', 1])).toBe('Xabc');
      expect(findBuiltin('INSRT')!.invoke(['X', 'abc', 9])).toBe('abcX');
    });

    it('CODEW returns code point, 0 out of range', () => {
      expect(findBuiltin('CODEW')!.invoke(['A', 1])).toBe(65);
      expect(findBuiltin('CODEW')!.invoke(['x', 5])).toBe(0);
    });

    it('VALUE parses numbers, tolerant to non-numeric', () => {
      expect(findBuiltin('VALUE')!.invoke(['42'])).toBe(42);
      expect(findBuiltin('VALUE')!.invoke(['x'])).toBe(0);
    });

    it('CAPIT initial-capitalises every word', () => {
      expect(findBuiltin('CAPIT')!.invoke(['first quarter sales'])).toBe('First Quarter Sales');
      expect(findBuiltin('CAPIT')!.invoke(['hello world'])).toBe('Hello World');
    });

    it('STR formats fixed-notation, right-justified (IBM examples)', () => {
      expect(findBuiltin('STR')!.invoke([1.5, 8, 2])).toBe('    1.50');
      expect(findBuiltin('STR')!.invoke([3.14159, 6, 2])).toBe('  3.14');
      expect(findBuiltin('STR')!.invoke([1000000, 4, 0])).toBe('1000'); // truncated
      expect(findBuiltin('STR')!.invoke([1000000, 4, 2])).toBe('1000000.00'); // preserved
      expect(findBuiltin('STR')!.invoke([14723017.2245, 4, 2])).toBe('14723017.22');
      expect(findBuiltin('STR')!.invoke([14723017.2245, 2, 2])).toBe(''); // > length+5
      expect(findBuiltin('STR')!.invoke([12345.6, 4, 1])).toBe('12345.6');
      expect(findBuiltin('STR')!.invoke([1.5, -1, 2])).toBe(''); // length<=0
      // negative overflow (decimals=0): sign counts toward width — total length == length
      expect((findBuiltin('STR')!.invoke([-1000000, 4, 0]) as string).length).toBe(4);
      expect(findBuiltin('STR')!.invoke([-5, 4, 0])).toBe('  -5'); // fits normally → right-justified
    });
  });

  describe('batch ⑦ common reads: date', () => {
    it('DATES builds yyyy-mm-dd and normalises overflow', () => {
      expect(findBuiltin('DATES')!.invoke([2021, 6, 6])).toBe('2021-06-06');
      expect(findBuiltin('DATES')!.invoke([2020, 13, 1])).toBe('2021-01-01');
    });
  });

  describe('TM1 serial dates (1960 epoch)', () => {
    it('DAYNO counts days from 1960-01-01 (TM1 epoch), not the Unix epoch', () => {
      expect(findBuiltin('DAYNO')!.invoke(['1960-01-01'])).toBe(0);
      expect(findBuiltin('DAYNO')!.invoke(['1998-03-09'])).toBe(13947);
    });

    it('DATE converts a serial to yy-mm-dd (default) or yyyy-mm-dd (flag)', () => {
      expect(findBuiltin('DATE')!.invoke([0, 1])).toBe('1960-01-01');
      expect(findBuiltin('DATE')!.invoke([0])).toBe('60-01-01');
      expect(findBuiltin('DATE')!.invoke([13947, 1])).toBe('1998-03-09');
      expect(findBuiltin('DATE')!.invoke([13947])).toBe('98-03-09');
    });

    it('DATE and DAYNO round-trip (4-digit and 2-digit years)', () => {
      expect(findBuiltin('DAYNO')!.invoke([findBuiltin('DATE')!.invoke([13947, 1])])).toBe(13947);
      // 2-digit DATE output stays parseable by YEAR/MONTH/DAY (windowed 1960-2059)
      expect(findBuiltin('YEAR')!.invoke([findBuiltin('DATE')!.invoke([13947])])).toBe(1998);
      expect(findBuiltin('MONTH')!.invoke([findBuiltin('DATE')!.invoke([13947])])).toBe(3);
      expect(findBuiltin('DAY')!.invoke([findBuiltin('DATE')!.invoke([13947])])).toBe(9);
    });

    it('TIMVL extracts a component by TM1 char code (I = minute, not M)', () => {
      expect(findBuiltin('TIMVL')!.invoke([11111.11, 'Y'])).toBe(1990);
      expect(findBuiltin('TIMVL')!.invoke([11111, 'M'])).toBe(6); // 1990-06-03
      expect(findBuiltin('TIMVL')!.invoke([11111, 'D'])).toBe(3);
      expect(findBuiltin('TIMVL')!.invoke([11111.11, 'H'])).toBe(2);
      expect(findBuiltin('TIMVL')!.invoke([11111.5, 'H'])).toBe(12);
    });
  });

  describe('batch ⑧ fixture-backed reads', () => {
    const fixtures = () => {
      const f = emptyFixtures();
      f.dimensions.set('Region', [
        { name: 'Total', level: 1, children: ['North', 'South'] },
        { name: 'North', level: 0 },
        { name: 'South', level: 0 },
      ]);
      f.attributes.set(attrKey('Region', 'North', 'Caption'), 'Nord');
      f.cubeCells.set(cubeCellKey('Sales', ['North', 'Jan']), 42);
      f.cubeCells.set(cubeCellKey('Sales', ['North', 'Feb']), 'hi');
      return f;
    };

    it('element structure reads', () => {
      const f = fixtures();
      expect(findBuiltin('LevelCount')!.invoke(['Region'], f)).toBe(2);
      expect(findBuiltin('ElementFirst')!.invoke(['Region', ''], f)).toBe('Total');
      expect(findBuiltin('ElementNext')!.invoke(['Region', '', 'Total'], f)).toBe('North');
      expect(findBuiltin('ElementNext')!.invoke(['Region', '', 'South'], f)).toBe('');
      expect(findBuiltin('DNEXT')!.invoke(['Region', 'North'], f)).toBe('South');
    });


    it('AttributeGet reads element attribute', () => {
      const f = fixtures();
      expect(findBuiltin('AttributeGet')!.invoke(['Region', 'North', 'Caption'], f)).toBe('Nord');
      expect(findBuiltin('AttributeGet')!.invoke(['Region', 'South', 'Caption'], f)).toBe('');
    });

    it('cell reads mirror CellGetN/S, CellIsUndefined flags missing cells', () => {
      const f = fixtures();
      expect(findBuiltin('CubeGetN')!.invoke(['Sales', 'North', 'Jan'], f)).toBe(42);
      expect(findBuiltin('CellValueN')!.invoke(['Sales', 'North', 'Jan'], f)).toBe(42);
      expect(findBuiltin('CubeGetS')!.invoke(['Sales', 'North', 'Feb'], f)).toBe('hi');
      expect(findBuiltin('CellIsUndefined')!.invoke(['Sales', 'North', 'Jan'], f)).toBe(0);
      expect(findBuiltin('CellIsUndefined')!.invoke(['Sales', 'North', 'Mar'], f)).toBe(1);
    });
  });
});
