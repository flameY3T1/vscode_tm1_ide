import { describe, it, expect } from 'vitest';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';

function diagsOf(code: string, section: any = 'prolog', options?: any) {
  const result = parseTiCode(code);
  const ast = result.ok ? result.ast : [];
  return lintTiAst(ast, undefined, code, undefined, section, options);
}

describe('exec-command-forbidden', () => {
  it('flags ExecuteCommand', () => {
    const d = diagsOf("ExecuteCommand('cmd', 1);");
    expect(d.some(x => x.ruleId === 'exec-command-forbidden')).toBe(true);
  });
  it('does not flag other functions', () => {
    const d = diagsOf("CellPutN(1, 'c', 'e');");
    expect(d.some(x => x.ruleId === 'exec-command-forbidden')).toBe(false);
  });
});

describe('process-call-not-literal', () => {
  it('flags ExecuteProcess with a variable first arg', () => {
    const d = diagsOf("ExecuteProcess(pName, 'p1', 1);");
    expect(d.some(x => x.ruleId === 'process-call-not-literal')).toBe(true);
  });
  it('does not flag a string-literal first arg', () => {
    const d = diagsOf("ExecuteProcess('MyProc', 'p1', 1);");
    expect(d.some(x => x.ruleId === 'process-call-not-literal')).toBe(false);
  });
  it('also checks RunProcess', () => {
    const d = diagsOf("RunProcess(pName);");
    expect(d.some(x => x.ruleId === 'process-call-not-literal')).toBe(true);
  });
});

describe('processquit-unreachable', () => {
  it('flags ProcessQuit followed by more statements in the block', () => {
    const d = diagsOf("ProcessQuit;\nx = 1;");
    expect(d.some(x => x.ruleId === 'processquit-unreachable')).toBe(true);
  });
  it('does not flag ProcessQuit as the last statement', () => {
    const d = diagsOf("x = 1;\nProcessQuit;");
    expect(d.some(x => x.ruleId === 'processquit-unreachable')).toBe(false);
  });
});

describe('wrong-section: record-loop functions (ItemSkip/ItemReject)', () => {
  it('flags ItemSkip in prolog', () => {
    const d = diagsOf("ItemSkip;", 'prolog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('allows ItemSkip in metadata', () => {
    const d = diagsOf("ItemSkip;", 'metadata');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('allows ItemSkip in data', () => {
    const d = diagsOf("ItemSkip;", 'data');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('allows ItemReject in metadata (bug-fix: was data-only)', () => {
    const d = diagsOf("ItemReject('bad');", 'metadata');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  // ItemReject works in every section — in the Prolog it is the standard
  // parameter-validation abort pattern (IF(<bad>); ItemReject('…'); ENDIF;).
  // Flagging it as wrong-section was a false positive.
  it('allows ItemReject in prolog (param-validation pattern)', () => {
    const d = diagsOf("ItemReject('bad');", 'prolog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('allows ItemReject in epilog', () => {
    const d = diagsOf("ItemReject('bad');", 'epilog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
});

describe('wrong-section: Datasource overrides are Prolog-only', () => {
  it('flags a Datasource assignment in data', () => {
    const d = diagsOf("DatasourceNameForServer = 'srv';", 'data');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('flags a Datasource assignment in epilog', () => {
    const d = diagsOf("DatasourceQuery = 'select 1';", 'epilog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('allows a Datasource assignment in prolog', () => {
    const d = diagsOf("DatasourceNameForServer = 'srv';", 'prolog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('flags MinorErrorLogMax outside prolog', () => {
    const d = diagsOf("MinorErrorLogMax = 100;", 'metadata');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('does not flag a normal local variable', () => {
    const d = diagsOf("nLocal = 5;", 'data');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
});

describe('wrong-section: metadata-update functions forbidden in Data + Epilog', () => {
  it('flags DimensionElementInsert in data', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'e', 'n');", 'data');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('flags DimensionElementInsert in epilog (IBM: metadata updates not in epilog)', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'e', 'n');", 'epilog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
  it('does NOT flag client/group security functions in epilog (IBM: no tab restriction; epilog is the documented spot after AddClient commits)', () => {
    for (const call of [
      "AddClientToGroup('c', 'g');",
      "AssignClientPassword('c', 'p');",
      "RemoveClientFromGroup('c', 'g');",
      "AssignClientToGroup('c', 'g');",
    ]) {
      const d = diagsOf(call, 'epilog');
      expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
    }
  });
  it('allows DimensionElementInsert in prolog', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'e', 'n');", 'prolog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('allows DimensionElementInsert in metadata', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'e', 'n');", 'metadata');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('SecurityRefresh is allowed in epilog (carve-out)', () => {
    const d = diagsOf("SecurityRefresh();", 'epilog');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(false);
  });
  it('SecurityRefresh in data still flagged (per-record perf)', () => {
    const d = diagsOf("SecurityRefresh();", 'data');
    expect(d.some(x => x.ruleId === 'wrong-section')).toBe(true);
  });
});

describe('invalid-object-name (IBM forbidden characters)', () => {
  it('flags a forbidden char in a created dimension name', () => {
    const d = diagsOf("DimensionCreate('bad;dim');", 'prolog');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(true);
  });
  it('flags @ in an inserted element name', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'el@em', 'n');", 'metadata');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(true);
  });
  it('flags a forbidden char in a created cube name', () => {
    const d = diagsOf("CubeCreate('Sales|2026', 'dimA', 'dimB');", 'prolog');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(true);
  });
  it('allows a clean object name', () => {
    const d = diagsOf("DimensionElementInsert('d', '', 'Element 01', 'n');", 'metadata');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(false);
  });
  it('does not flag a variable (non-literal) name argument', () => {
    const d = diagsOf("DimensionElementInsert('d', '', vElem, 'n');", 'metadata');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(false);
  });
  it('does not flag reference args (existing dim names) of CubeCreate', () => {
    // dimA/dimB are referenced, not created — only arg 0 (the new cube) is checked
    const d = diagsOf("CubeCreate('CleanCube', 'dimA', 'dimB');", 'prolog');
    expect(d.some(x => x.ruleId === 'invalid-object-name')).toBe(false);
  });
});

describe('comment-before-if / comment-before-while', () => {
  it('flags an IF with no preceding comment', () => {
    const d = diagsOf("nX = 1;\nIF(nX = 1);\n  nY = 2;\nENDIF;", 'prolog');
    expect(d.some(x => x.ruleId === 'comment-before-if')).toBe(true);
  });
  it('allows an IF preceded by a # comment', () => {
    const d = diagsOf("# check flag\nIF(nX = 1);\n  nY = 2;\nENDIF;", 'prolog');
    expect(d.some(x => x.ruleId === 'comment-before-if')).toBe(false);
  });
  it('skips blank lines between comment and IF', () => {
    const d = diagsOf("# check flag\n\nIF(nX = 1);\n  nY = 2;\nENDIF;", 'prolog');
    expect(d.some(x => x.ruleId === 'comment-before-if')).toBe(false);
  });
  it('flags a WHILE with no preceding comment', () => {
    const d = diagsOf("nI = 0;\nWHILE(nI < 5);\n  nI = nI + 1;\nEND;", 'prolog');
    expect(d.some(x => x.ruleId === 'comment-before-while')).toBe(true);
  });
  it('allows a WHILE preceded by a # comment', () => {
    const d = diagsOf("# loop rows\nWHILE(nI < 5);\n  nI = nI + 1;\nEND;", 'prolog');
    expect(d.some(x => x.ruleId === 'comment-before-while')).toBe(false);
  });
});

describe('odbc-password-not-param', () => {
  it('flags a hardcoded string-literal password', () => {
    const d = diagsOf("ODBCOpen('dsn', 'user', 'secret');", 'prolog', { paramNames: ['pPwd'] });
    expect(d.some(x => x.ruleId === 'odbc-password-not-param')).toBe(true);
  });
  it('allows a declared parameter as password', () => {
    const d = diagsOf("ODBCOpen('dsn', 'user', pPwd);", 'prolog', { paramNames: ['pPwd'] });
    expect(d.some(x => x.ruleId === 'odbc-password-not-param')).toBe(false);
  });
  it('skips when no paramNames context is available', () => {
    const d = diagsOf("ODBCOpen('dsn', 'user', 'secret');", 'prolog');
    expect(d.some(x => x.ruleId === 'odbc-password-not-param')).toBe(false);
  });
});

describe('readonly-param-write', () => {
  it('flags assignment to a parameter', () => {
    const d = diagsOf("pVal = 5;", 'prolog', { paramNames: ['pVal'] });
    expect(d.some(x => x.ruleId === 'readonly-param-write')).toBe(true);
  });
  it('flags assignment to a datasource variable', () => {
    const d = diagsOf("vCol = 5;", 'prolog', { datasourceVars: ['vCol'] });
    expect(d.some(x => x.ruleId === 'readonly-param-write')).toBe(true);
  });
  it('does not flag a normal local variable', () => {
    const d = diagsOf("nLocal = 5;", 'prolog', { paramNames: ['pVal'] });
    expect(d.some(x => x.ruleId === 'readonly-param-write')).toBe(false);
  });
});
