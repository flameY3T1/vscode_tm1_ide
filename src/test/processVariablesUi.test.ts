import { describe, it, expect, vi } from 'vitest';

// loadProcesses pulls the REST facade in transitively; the .pro export path under
// test never issues a request, so a bare stub keeps the import graph off the network.
vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn(),
}));

import {
  mergeVariableColumns,
  splitVariableColumns,
  parseUiEntry,
  serializeUiEntry,
  isIgnoredUiEntry,
  COL_TYPE_IGNORE,
  COL_TYPE_OTHER,
} from '../utils/processVariablesUi';
import { toRestVariables, toProUiData, toProHasSecurity } from '../utils/proFile';
import { buildProFile } from '../commands/processEditor/loadProcesses';

const FF = '\f';
const ui = (fields: Record<string, string | number>) =>
  Object.entries(fields).map(([k, v]) => `${k}=${v}${FF}`).join('');

/**
 * The live shape of `00500_Import_DIM_TREE` (11.8, measured 2026-08-29): seven
 * source columns, the first three set to Contents="Ignore", so `Variables` holds
 * only four entries and their positions start at 4.
 */
const LIVE_UI = [
  ui({ IgnoredInputVarName: 'vsSTRN', VarType: 32, ColType: 1165 }),
  ui({ IgnoredInputVarName: 'vname', VarType: 32, ColType: 1165 }),
  ui({ IgnoredInputVarName: 'v21', VarType: 32, ColType: 1165 }),
  ui({ VarType: 32, ColType: 827 }),
  ui({ VarType: 32, ColType: 827 }),
  ui({ VarType: 32, ColType: 827 }),
  ui({ VarType: 33, ColType: 827 }),
];
const LIVE_VARS = [
  { Name: 'vsParent', Type: 'String' as const, Position: 4, StartByte: 0, EndByte: 0 },
  { Name: 'vsChild', Type: 'String' as const, Position: 5, StartByte: 0, EndByte: 0 },
  { Name: 'vsType', Type: 'String' as const, Position: 6, StartByte: 0, EndByte: 0 },
  { Name: 'vnValue', Type: 'Numeric' as const, Position: 7, StartByte: 0, EndByte: 0 },
];

describe('parseUiEntry / serializeUiEntry', () => {
  it('splits on the form feed TM1 actually writes', () => {
    expect(parseUiEntry('VarType=32\fColType=827\f')).toEqual([
      { key: 'VarType', value: '32' },
      { key: 'ColType', value: '827' },
    ]);
  });

  it('also accepts the comma form TM1py writes', () => {
    expect(parseUiEntry('VarType=33,ColType=827')).toEqual([
      { key: 'VarType', value: '33' },
      { key: 'ColType', value: '827' },
    ]);
  });

  it('round-trips into TM1 form with a trailing separator per field', () => {
    const entry = 'IgnoredInputVarName=vsSTRN\fVarType=32\fColType=1165\f';
    expect(serializeUiEntry(parseUiEntry(entry))).toBe(entry);
  });

  it('reads the ignore mark from either the name field or the ColType', () => {
    expect(isIgnoredUiEntry('IgnoredInputVarName=x\fVarType=32\fColType=1165\f')).toBe(true);
    expect(isIgnoredUiEntry(`VarType=32\fColType=${COL_TYPE_IGNORE}\f`)).toBe(true);
    expect(isIgnoredUiEntry(`VarType=32\fColType=${COL_TYPE_OTHER}\f`)).toBe(false);
  });
});

describe('mergeVariableColumns', () => {
  it('recovers the ignored columns TM1 keeps out of Variables', () => {
    const cols = mergeVariableColumns(LIVE_VARS, LIVE_UI);
    expect(cols.map(c => `${c.Name}${c.Ignored ? ' (ign)' : ''}@${c.Position}`)).toEqual([
      'vsSTRN (ign)@1',
      'vname (ign)@2',
      'v21 (ign)@3',
      'vsParent@4',
      'vsChild@5',
      'vsType@6',
      'vnValue@7',
    ]);
  });

  it('rebuilds the entries canonically — without a carried-along raw form', () => {
    // Re-measured live (11.8, 2026-08-30): 2207 entries across 335 processes,
    // exclusively the keys IgnoredInputVarName/VarType/ColType, only the
    // ColType values 827 and 1165, every entry separated by U+000C. The round trip
    // is therefore character-exact, without a raw form having to travel along in the model.
    const cols = mergeVariableColumns(LIVE_VARS, LIVE_UI);
    expect(splitVariableColumns(cols).VariablesUIData).toEqual(LIVE_UI);
  });

  it('normalizes a ColType we do not know', () => {
    // The price of removing `UiRaw` (2026-08-30): for *Contents* Architect also
    // knows Element/Consolidation/Data/Attribute, which presumably carry their own
    // ColType numbers. Nobody on the test server uses them (0 of 2207).
    // If one ever turned up, saving would rewrite it to 827 — decided this way
    // on purpose, so that the JSON stays native.
    const [foreign] = mergeVariableColumns(
      [{ Name: 'vE', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      [ui({ VarType: 32, ColType: 830 })],
    );
    expect(foreign).not.toHaveProperty('UiRaw');
    expect(splitVariableColumns([foreign]).VariablesUIData[0])
      .toBe(ui({ VarType: 32, ColType: 827 }));
  });

  it('writes TM1 form again even from an unreadable entry', () => {
    const [col] = mergeVariableColumns(
      [{ Name: 'vG', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      ['VarType=32?ColType=827?'],
    );
    expect(splitVariableColumns([col]).VariablesUIData[0]).toBe('VarType=32\fColType=827\f');
  });

  it('treats every variable as a normal column when there is no UIData', () => {
    const cols = mergeVariableColumns(LIVE_VARS, []);
    expect(cols).toHaveLength(4);
    expect(cols.some(c => c.Ignored)).toBe(false);
  });

  it('sorts by Position, so a shuffled Variables array still lines up', () => {
    const cols = mergeVariableColumns([LIVE_VARS[3], LIVE_VARS[0], LIVE_VARS[2], LIVE_VARS[1]], LIVE_UI);
    expect(cols.filter(c => !c.Ignored).map(c => c.Name)).toEqual(['vsParent', 'vsChild', 'vsType', 'vnValue']);
  });

  it('never drops a variable the UIData does not account for', () => {
    // Drift the editor could hit on a process saved before UIData was written.
    const cols = mergeVariableColumns(LIVE_VARS, LIVE_UI.slice(0, 5));
    expect(cols.filter(c => !c.Ignored).map(c => c.Name)).toEqual(['vsParent', 'vsChild', 'vsType', 'vnValue']);
  });

  it('derives ignored positions from the neighbours, not from the array index', () => {
    const cols = mergeVariableColumns(
      [{ Name: 'vA', Type: 'String', Position: 5, StartByte: 0, EndByte: 0 }],
      [ui({ VarType: 32, ColType: 827 }), ui({ IgnoredInputVarName: 'vB', VarType: 32, ColType: 1165 })],
    );
    expect(cols.map(c => c.Position)).toEqual([5, 6]);
  });

  it('takes an ignored column type from its UIData VarType', () => {
    const cols = mergeVariableColumns([], [ui({ IgnoredInputVarName: 'vN', VarType: 33, ColType: 1165 })]);
    expect(cols[0]).toMatchObject({ Name: 'vN', Type: 'Numeric', Ignored: true });
  });
});

describe('splitVariableColumns', () => {
  it('reproduces the live pair exactly', () => {
    const { Variables, VariablesUIData } = splitVariableColumns(mergeVariableColumns(LIVE_VARS, LIVE_UI));
    expect(Variables).toEqual(LIVE_VARS);
    expect(VariablesUIData).toEqual(LIVE_UI);
  });

  it('keeps an ignored name out of Variables and inside the UIData entry', () => {
    const { Variables, VariablesUIData } = splitVariableColumns([
      { Name: 'vGone', Type: 'String', Position: 1, StartByte: 0, EndByte: 0, Ignored: true },
      { Name: 'vKept', Type: 'Numeric', Position: 2, StartByte: 0, EndByte: 0 },
    ]);
    expect(Variables).toEqual([{ Name: 'vKept', Type: 'Numeric', Position: 2, StartByte: 0, EndByte: 0 }]);
    expect(VariablesUIData).toEqual([
      'IgnoredInputVarName=vGone\fVarType=32\fColType=1165\f',
      'VarType=33\fColType=827\f',
    ]);
  });

  it('emits one UIData entry per column even when nothing is ignored', () => {
    const { Variables, VariablesUIData } = splitVariableColumns([
      { Name: 'a', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 },
      { Name: 'b', Type: 'String', Position: 2, StartByte: 0, EndByte: 0 },
    ]);
    expect(Variables).toHaveLength(2);
    expect(VariablesUIData).toHaveLength(2);
  });

  it('drops the ignore mark when a column is switched back to Other', () => {
    const [col] = mergeVariableColumns([], [ui({ IgnoredInputVarName: 'vX', VarType: 32, ColType: 1165 })]);
    const { Variables, VariablesUIData } = splitVariableColumns([{ ...col, Ignored: false }]);
    expect(Variables).toEqual([{ Name: 'vX', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }]);
    expect(VariablesUIData[0]).not.toMatch(/IgnoredInputVarName/);
    expect(VariablesUIData[0]).toContain('ColType=827');
  });

  // Until 2026-08-30 these two cases preserved a foreign ColType and an
  // unknown key, because `VariableColumn` carried the raw form along as `UiRaw`.
  // The field never triggered live (0 of 2207 entries) and in return sat
  // as a foreign body in every draft and every Git export.
  // Removed: the canonical form is now always written.
  it('normalizes a foreign ColType instead of preserving it', () => {
    const cols = mergeVariableColumns(
      [{ Name: 'vE', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      [ui({ VarType: 32, ColType: 830 })],
    );
    expect(splitVariableColumns(cols).VariablesUIData[0]).toBe(ui({ VarType: 32, ColType: 827 }));
  });

  it('drops an unknown key', () => {
    const cols = mergeVariableColumns(
      [{ Name: 'vF', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      [ui({ VarType: 32, ColType: 827, SQLType: 4 })],
    );
    expect(splitVariableColumns(cols).VariablesUIData[0]).toBe(ui({ VarType: 32, ColType: 827 }));
  });

  it('follows a type change into the UIData VarType', () => {
    const cols = mergeVariableColumns(
      [{ Name: 'vG', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      [ui({ VarType: 32, ColType: 827 })],
    );
    const out = splitVariableColumns([{ ...cols[0], Type: 'Numeric' }]);
    expect(out.VariablesUIData[0]).toContain('VarType=33');
  });
});

describe('.pro round trip', () => {
  const proc = {
    Name: 'zz_ignvar',
    PrologProcedure: '#****Begin: Generated Statements***\n#****End: Generated Statements****',
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: '',
    DataSource: { Type: 'ASCII', dataSourceNameForServer: 'x.csv', asciiDelimiterType: 'Character' },
    Parameters: [],
    Variables: LIVE_VARS,
    VariablesUIData: LIVE_UI,
  };

  it('writes block 577 for the used columns and 582 for all of them', () => {
    const pro = buildProFile(proc);
    expect(pro).toContain('577,4');
    expect(pro).toContain('582,7');
  });

  it('keeps the ignored names, which live in block 582 alone', () => {
    const pro = buildProFile(proc);
    expect(pro).toContain('IgnoredInputVarName=vsSTRN');
    // …and not among the plain variable names of block 577.
    const names = pro.split('\n');
    expect(names.filter(l => l.trim() === 'vsSTRN')).toHaveLength(0);
  });

  it('reads the full column list back out of the file', () => {
    const back = toRestVariables(buildProFile(proc));
    expect(back.map(v => `${v.Name}${v.Ignored ? ' (ign)' : ''}`)).toEqual([
      'vsSTRN (ign)', 'vname (ign)', 'v21 (ign)',
      'vsParent', 'vsChild', 'vsType', 'vnValue',
    ]);
    expect(back.map(v => v.Position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(back.find(v => v.Name === 'vnValue')?.Type).toBe('Numeric');
  });

  it('carries HasSecurityAccess in footer line 1217, where TM1 keeps it', () => {
    expect(toProHasSecurity(buildProFile({ ...proc, HasSecurityAccess: true }))).toBe(true);
    expect(toProHasSecurity(buildProFile({ ...proc, HasSecurityAccess: false }))).toBe(false);
    expect(buildProFile({ ...proc, HasSecurityAccess: true })).toMatch(/^603,0\r?$/m);
  });

  it('survives a second trip unchanged', () => {
    const once = buildProFile(proc);
    const twice = buildProFile({ ...proc, ...splitVariableColumns(toRestVariables(once)) });
    expect(twice).toBe(once);
  });

  it('still reads a .pro without block 582', () => {
    const legacy = buildProFile(proc).split('\n');
    const at = legacy.findIndex(l => l.replace(/\r$/, '') === '582,7');
    expect(at).toBeGreaterThan(-1);
    legacy.splice(at, 8);
    const back = toRestVariables(legacy.join('\n'));
    expect(back.map(v => v.Name)).toEqual(['vsParent', 'vsChild', 'vsType', 'vnValue']);
    expect(back.some(v => v.Ignored)).toBe(false);
  });
});

describe('block 576 — Architect wizard state', () => {
  const UI_DATA = 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=1\f_ParameterConstraints=e30=\f';
  const base = {
    Name: 'zz_uidata',
    PrologProcedure: '#****Begin: Generated Statements***\n#****End: Generated Statements****',
    MetadataProcedure: '',
    DataProcedure: '',
    EpilogProcedure: '',
    DataSource: { Type: 'None' },
    Parameters: [],
    Variables: [],
  };

  it('writes the value verbatim, form feeds and all', () => {
    const pro = buildProFile({ ...base, UIData: UI_DATA });
    expect(pro).toContain(`576,${UI_DATA}`);
  });

  it('reads it back off the footer', () => {
    expect(toProUiData(buildProFile({ ...base, UIData: UI_DATA }))).toBe(UI_DATA);
  });

  it('falls back to what TM1 writes for an untouched process', () => {
    // Reached only when the server hands out no UIData — never as a stand-in for
    // a value we failed to select.
    const back = toProUiData(buildProFile(base));
    expect(back).toBe('CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f');
  });

  it('takes the footer, not a look-alike line inside the code', () => {
    const pro = buildProFile({ ...base, PrologProcedure: 'sText = \'576,CubeAction=9999\';', UIData: UI_DATA });
    expect(toProUiData(pro)).toBe(UI_DATA);
  });

  it('keeps an empty line as an empty value (TM1 12 stores UIData: "")', () => {
    expect(toProUiData('575,0\n576,\n930,0\n')).toBe('');
  });

  it('reports nothing for a file without the block', () => {
    expect(toProUiData('602,"x"\n572,0\n')).toBeUndefined();
  });
});
