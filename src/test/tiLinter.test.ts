import { lintTiAst, lintTiAstWithContext, collectAllReads, findUndefinedVariables } from '../tiLogicVisualizer/tiLinter';
import type {
  TiAst,
} from '../tiLogicVisualizer/types';

// --- Requirement 1.4: Empty AST → empty array ---
describe('Empty AST (Req 1.4)', () => {
  it('returns an empty array for an empty AST', () => {
    const ast: TiAst = [];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics).toEqual([]);
  });
});

// --- Requirement 8.3: Inline IF type inference ---
describe('Inline IF type inference (Req 8.3)', () => {
  it('infers string type from IF(cond, string, string)', () => {
    const ast: TiAst = [
      {
        type: 'assignment',
        variable: 'sResult',
        expression: "IF(cond, 'hello', 'world')",
        isExternal: false,
        line: 1,
      },
      // Second assignment with numeric should trigger type-mismatch
      {
        type: 'assignment',
        variable: 'sResult',
        expression: '42',
        isExternal: false,
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const mismatch = diagnostics.find(d => d.ruleId === 'type-mismatch-assignment');
    expect(mismatch).toBeDefined();
    expect(mismatch!.line).toBe(2);
    expect(mismatch!.messageArgs).toContain('sResult');
    expect(mismatch!.messageArgs).toContain('string');
    expect(mismatch!.messageArgs).toContain('numeric');
  });

  it('infers numeric type from IF(cond, number, number)', () => {
    const ast: TiAst = [
      {
        type: 'assignment',
        variable: 'nResult',
        expression: 'IF(cond, 42, 0)',
        isExternal: false,
        line: 1,
      },
      // Second assignment with string should trigger type-mismatch
      {
        type: 'assignment',
        variable: 'nResult',
        expression: "'text'",
        isExternal: false,
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const mismatch = diagnostics.find(d => d.ruleId === 'type-mismatch-assignment');
    expect(mismatch).toBeDefined();
    expect(mismatch!.line).toBe(2);
    expect(mismatch!.messageArgs).toContain('nResult');
  });
});


// --- Nested WHILE loops with shared variables ---
describe('Nested WHILE loops with shared variables', () => {
  it('should NOT report endless-loop for outer WHILE when inner loop modifies condition variable', () => {
    const ast: TiAst = [
      {
        type: 'while',
        condition: 'i < 10',
        body: [
          {
            type: 'while',
            condition: 'j < 5',
            body: [
              // Inner loop modifies i (used in outer condition)
              {
                type: 'assignment',
                variable: 'i',
                expression: 'i + 1',
                isExternal: false,
                line: 3,
              },
              {
                type: 'assignment',
                variable: 'j',
                expression: 'j + 1',
                isExternal: false,
                line: 4,
              },
            ],
            line: 2,
          },
        ],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const outerEndless = diagnostics.find(
      d => d.ruleId === 'endless-loop' && d.line === 1
    );
    // Outer WHILE should NOT be flagged — i is modified in the inner loop body
    expect(outerEndless).toBeUndefined();
  });
});

// --- WHILE with function call in condition (no user variables to check) ---
describe('WHILE with function call in condition', () => {
  it('should NOT report endless-loop when condition has no extractable user variables', () => {
    // Condition: RAND() > 0 — RAND is a known function, 0 is a numeric literal.
    // extractIdentifiers filters out known functions and keywords, leaving no variables.
    const ast: TiAst = [
      {
        type: 'while',
        condition: 'RAND() > 0',
        body: [
          {
            type: 'functionCall',
            name: 'LogOutput',
            args: ['1', "'processing'"],
            line: 2,
          },
        ],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const endless = diagnostics.find(d => d.ruleId === 'endless-loop');
    // No user variables in condition → conditionVars is empty → no endless-loop check
    expect(endless).toBeUndefined();
  });

  it('should report endless-loop when condition has a variable extracted from string literal context', () => {
    // DIMSIZ('dim') > 0 — the regex-based identifier extraction picks up 'dim'
    // from inside the string literal. Since 'dim' is not modified in the body,
    // the linter reports endless-loop. This tests the actual behavior.
    const ast: TiAst = [
      {
        type: 'while',
        condition: "DIMSIZ('dim') > 0",
        body: [
          {
            type: 'functionCall',
            name: 'LogOutput',
            args: ['1', "'processing'"],
            line: 2,
          },
        ],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const endless = diagnostics.find(d => d.ruleId === 'endless-loop');
    // 'dim' is extracted as a variable from the condition, and it's not modified in body
    expect(endless).toBeDefined();
    expect(endless!.line).toBe(1);
  });
});

// --- CellPut followed by IF-ProcessError check → no diagnostic ---
describe('CellPut with error handling', () => {
  it('should NOT report cellput-no-error-handling when followed by IF(ProcessError)', () => {
    const ast: TiAst = [
      {
        type: 'functionCall',
        name: 'CellPutN',
        args: ['42', "'MyCube'", "'Dim1'", "'Elem1'"],
        line: 1,
      },
      {
        type: 'if',
        condition: 'ProcessError = 1',
        thenBody: [
          {
            type: 'functionCall',
            name: 'ProcessQuit',
            args: [],
            line: 3,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeUndefined();
  });

  it('should NOT report cellput-no-error-handling for CellPutS followed by ProcessError check', () => {
    const ast: TiAst = [
      {
        type: 'functionCall',
        name: 'CellPutS',
        args: ["'value'", "'MyCube'", "'Dim1'", "'Elem1'"],
        line: 1,
      },
      {
        type: 'if',
        condition: 'ProcessError = 1',
        thenBody: [
          {
            type: 'functionCall',
            name: 'ItemReject',
            args: [],
            line: 3,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeUndefined();
  });

  it('reports cellput-no-error-handling for a bare CellPutN without any guard', () => {
    const ast: TiAst = [
      {
        type: 'functionCall',
        name: 'CellPutN',
        args: ['1', "'cube'", "'a'", "'b'"],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeDefined();
    expect(cellputError!.line).toBe(1);
    expect(cellputError!.severity).toBe('warning');
    expect(cellputError!.ruleId).toBe('cellput-no-error-handling');
    expect(cellputError!.messageArgs).toContain('CellPutN');
  });

  it('reports cellput-no-error-handling for CellIncrementN without any guard', () => {
    const ast: TiAst = [
      {
        type: 'functionCall',
        name: 'CellIncrementN',
        args: ['1', "'cube'", "'a'", "'b'"],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeDefined();
    expect(cellputError!.line).toBe(1);
  });

  it('should NOT report when the CellPut sits inside an IF(CellIsUpdateable...) block', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: "CellIsUpdateable('cube', 'a', 'b') = 1",
        thenBody: [
          {
            type: 'functionCall',
            name: 'CellPutN',
            args: ['1', "'cube'", "'a'", "'b'"],
            line: 2,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeUndefined();
  });

  it('should NOT report when a preceding IF(CellIsUpdateable...) exists in the same block', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: "CellIsUpdateable('cube', 'a', 'b') = 0",
        thenBody: [
          { type: 'functionCall', name: 'ItemSkip', args: [], line: 2 },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
      {
        type: 'functionCall',
        name: 'CellPutN',
        args: ['1', "'cube'", "'a'", "'b'"],
        line: 4,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputError = diagnostics.find(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputError).toBeUndefined();
  });

  it('reports only ONE diagnostic for multiple unguarded CellPuts in the same block', () => {
    const ast: TiAst = [
      { type: 'functionCall', name: 'CellPutN', args: ['1', "'cube'", "'a'", "'b'"], line: 1 },
      { type: 'functionCall', name: 'CellPutS', args: ["'v'", "'cube'", "'a'", "'b'"], line: 2 },
      { type: 'functionCall', name: 'CellIncrementN', args: ['1', "'cube'", "'a'", "'b'"], line: 3 },
    ];
    const diagnostics = lintTiAst(ast);
    const cellputErrors = diagnostics.filter(d => d.ruleId === 'cellput-no-error-handling');
    expect(cellputErrors).toHaveLength(1);
    expect(cellputErrors[0].line).toBe(1);
  });
});

// --- Requirement 7.2: All messages in German ---
describe('German messages (Req 7.2)', () => {
  it('endless-loop message is in German', () => {
    const ast: TiAst = [
      {
        type: 'while',
        condition: 'x > 0',
        body: [
          {
            type: 'functionCall',
            name: 'LogOutput',
            args: ['1', "'msg'"],
            line: 2,
          },
        ],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const endless = diagnostics.find(d => d.ruleId === 'endless-loop');
    expect(endless).toBeDefined();
    expect(endless!.messageKey).toContain('Potential endless loop');
  });

  it('type-mismatch-assignment emits messageKey', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'v', expression: "'text'", isExternal: false, line: 1 },
      { type: 'assignment', variable: 'v', expression: '42', isExternal: false, line: 2 },
    ];
    const diagnostics = lintTiAst(ast);
    const mismatch = diagnostics.find(d => d.ruleId === 'type-mismatch-assignment');
    expect(mismatch).toBeDefined();
    expect(mismatch!.messageKey).toContain('is of type');
  });

  it('unused-variable emits messageKey + variable name as arg', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'unused', expression: '1', isExternal: false, line: 1 },
    ];
    const diagnostics = lintTiAst(ast);
    const unused = diagnostics.find(d => d.ruleId === 'unused-variable');
    expect(unused).toBeDefined();
    expect(unused!.messageKey).toContain('is assigned but never used');
    expect(unused!.messageArgs).toEqual(['unused']);
  });

  it('empty-if emits messageKey', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'x > 0',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const emptyIf = diagnostics.find(d => d.ruleId === 'empty-if');
    expect(emptyIf).toBeDefined();
    expect(emptyIf!.messageKey).toContain('Empty IF block');
  });

  it('unknown-function emits messageKey + function name as arg', () => {
    const ast: TiAst = [
      {
        type: 'functionCall',
        name: 'MeineUnbekannteFunktion',
        args: [],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const unknown = diagnostics.find(d => d.ruleId === 'unknown-function');
    expect(unknown).toBeDefined();
    expect(unknown!.messageKey).toContain('Unknown function');
    expect(unknown!.messageArgs).toEqual(['MeineUnbekannteFunktion']);
  });

  it('bare Break keyword is not flagged as unknown-function', () => {
    // Parser emits `Break;` as functionCall name='Break' args=[]; linter
    // must treat it as a bare keyword, not a missing function signature.
    const ast: TiAst = [
      { type: 'functionCall', name: 'Break', args: [], line: 1 },
    ];
    const diagnostics = lintTiAst(ast);
    const unknown = diagnostics.find(d => d.ruleId === 'unknown-function');
    expect(unknown).toBeUndefined();
  });

  it('ternary IF expression is not flagged as unknown-function', () => {
    // Parser emits `IF(cond, a, b);` as functionCall name='IF' args=[...];
    // linter must treat IF as a control-flow keyword, not a missing signature.
    const ast: TiAst = [
      { type: 'functionCall', name: 'IF', args: ["vsVAR@<>''", '0', 'itemskip'], line: 1 },
    ];
    const diagnostics = lintTiAst(ast);
    const unknown = diagnostics.find(d => d.ruleId === 'unknown-function');
    expect(unknown).toBeUndefined();
  });
});

// ─── Type-aware operator check (Req: string-compare-without-at / numeric-compare-with-at) ─────

describe('Type-aware operator check (variableTypes)', () => {
  // ── String variable with numeric operator ─────────────────────────────────

  it('string-compare-without-at: string variable = string literal', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'sVar', expression: "'hello'", isExternal: false, line: 1 },
      {
        type: 'if',
        condition: "sVar = 'x'",
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const d = diagnostics.find(d => d.ruleId === 'string-compare-without-at');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.line).toBe(2);
  });

  it('string-compare-without-at: string variable <> numeric literal', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'sVar', expression: "'text'", isExternal: false, line: 1 },
      {
        type: 'if',
        condition: 'sVar <> 0',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.find(d => d.ruleId === 'string-compare-without-at')).toBeDefined();
  });

  it('string-compare-without-at: external parameter (knownVariables) with numeric operator', () => {
    const knownVariables: Map<string, { type: 'string' | 'numeric'; firstAssignmentLine: number }> = new Map([
      ['pparam01', { type: 'string', firstAssignmentLine: 0 }],
    ]);
    const ast: TiAst = [
      {
        type: 'if',
        condition: "pParam01 = 'X'",
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 5,
      },
    ];
    const diagnostics = lintTiAst(ast, knownVariables);
    const d = diagnostics.find(d => d.ruleId === 'string-compare-without-at');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
  });

  // ── Numeric variable with @ operator ─────────────────────────────────────

  it('numeric-compare-with-at: numeric variable @= numeric literal', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'nVar', expression: '42', isExternal: false, line: 1 },
      {
        type: 'if',
        condition: 'nVar @= 42',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    const d = diagnostics.find(d => d.ruleId === 'numeric-compare-with-at');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('numeric-compare-with-at: string variable @= numeric literal (reported case)', () => {
    const knownVariables: Map<string, { type: 'string' | 'numeric'; firstAssignmentLine: number }> = new Map([
      ['pparam01', { type: 'string', firstAssignmentLine: 0 }],
    ]);
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'pParam01 @= 1',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 3,
      },
    ];
    const diagnostics = lintTiAst(ast, knownVariables);
    const d = diagnostics.find(d => d.ruleId === 'numeric-compare-with-at');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.line).toBe(3);
  });

  it('numeric-compare-with-at: comparison embedded in an IF() function call on the RHS of an assignment', () => {
    const knownVariables: Map<string, { type: 'string' | 'numeric'; firstAssignmentLine: number }> = new Map([
      ['pparam01', { type: 'string', firstAssignmentLine: 0 }],
    ]);
    const ast: TiAst = [
      { type: 'assignment', variable: 'x', expression: "IF(pParam01@=1, 'x', 'y')", isExternal: false, line: 4 },
    ];
    const diagnostics = lintTiAst(ast, knownVariables);
    const d = diagnostics.find(d => d.ruleId === 'numeric-compare-with-at');
    expect(d).toBeDefined();
    expect(d!.line).toBe(4);
  });

  // ── Correct comparisons should not trigger a diagnostic ──────────────────

  it('no error: string variable @= string literal', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'sVar', expression: "'hello'", isExternal: false, line: 1 },
      {
        type: 'if',
        condition: "sVar @= 'x'",
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.find(d => d.ruleId === 'string-compare-without-at')).toBeUndefined();
    expect(diagnostics.find(d => d.ruleId === 'numeric-compare-with-at')).toBeUndefined();
  });

  it('no error: numeric variable = numeric literal', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'nVal', expression: '0', isExternal: false, line: 1 },
      {
        type: 'if',
        condition: 'nVal = 5',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 2,
      },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.find(d => d.ruleId === 'string-compare-without-at')).toBeUndefined();
    expect(diagnostics.find(d => d.ruleId === 'numeric-compare-with-at')).toBeUndefined();
  });

  it('string-compare-without-at: a string literal on one side is enough for an error', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: "'x' = vUnknown",
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.find(d => d.ruleId === 'string-compare-without-at')).toBeDefined();
  });

  it('no error: both sides unknown variables → no false positive', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'vA = vB',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.find(d => d.ruleId === 'string-compare-without-at')).toBeUndefined();
    expect(diagnostics.find(d => d.ruleId === 'numeric-compare-with-at')).toBeUndefined();
  });
});

// ─── Cross-section unused-variable (futureReads) ─────────────────────────────

import { parseTiCode } from '../tiLogicVisualizer/tiParser';

describe('unused-variable — cross-section futureReads', () => {
  it('does NOT flag a variable assigned in prolog when it is read in a later section', () => {
    const prologCode = 'vResult = 0;';
    const metaCode = 'vResult = vResult + 1;';

    const prologAst = parseTiCode(prologCode);
    const metaAst = parseTiCode(metaCode);
    if (!prologAst.ok || !metaAst.ok) { throw new Error('parse failed'); }

    // futureReads = everything read in metadata
    const futureReads = collectAllReads(metaAst.ast);

    const { diagnostics } = lintTiAstWithContext(prologAst.ast, undefined, prologCode, futureReads, 'prolog');
    expect(diagnostics.find(d => d.ruleId === 'unused-variable')).toBeUndefined();
  });

  it('DOES flag a variable assigned in prolog when it is never read in any section', () => {
    const prologCode = 'vUnused = 42;';
    const metaCode = 'vOther = 1;';

    const prologAst = parseTiCode(prologCode);
    const metaAst = parseTiCode(metaCode);
    if (!prologAst.ok || !metaAst.ok) { throw new Error('parse failed'); }

    const futureReads = collectAllReads(metaAst.ast);

    const { diagnostics } = lintTiAstWithContext(prologAst.ast, undefined, prologCode, futureReads, 'prolog');
    expect(diagnostics.find(d => d.ruleId === 'unused-variable')).toBeDefined();
  });

  it('does NOT flag a variable read in epilog even if only assigned in prolog', () => {
    const prologCode = 'vFlag = 1;';
    const metaCode = '';
    const dataCode = '';
    const epilogCode = 'IF(vFlag = 1);\n  ProcessQuit;\nENDIF;';

    const sections = [prologCode, metaCode, dataCode, epilogCode].map(c => parseTiCode(c));
    const asts = sections.map((s, i) => { if (!s.ok) { throw new Error(`parse failed section ${i}`); } return s.ast; });

    const allReads = asts.map(a => collectAllReads(a));

    // futureReads for prolog = union of reads in meta + data + epilog
    const futureReads = new Set<string>();
    for (let j = 1; j < 4; j++) { for (const v of allReads[j]) { futureReads.add(v); } }

    const { diagnostics } = lintTiAstWithContext(asts[0], undefined, prologCode, futureReads, 'prolog');
    expect(diagnostics.find(d => d.ruleId === 'unused-variable')).toBeUndefined();
  });
});

// ─── Datasource* pseudo-variable assignments ────────────────────────────────

describe('unused-variable — Datasource* pseudo-variables (system vars)', () => {
  it('does not flag DatasourceCubeview = vViewName as unused', () => {
    const code = [
      "vCube = 'Sales';",
      "vViewName = 'MyView';",
      "DatasourceNameForServer = vCube;",
      "DatasourceCubeview = vViewName;",
    ].join('\n');
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    const unusedNames = diagnostics
      .filter(d => d.ruleId === 'unused-variable')
      .map(d => d.message ?? '');
    expect(unusedNames.find(m => m.includes('DatasourceCubeview'))).toBeUndefined();
    expect(unusedNames.find(m => m.includes('DatasourceNameForServer'))).toBeUndefined();
  });

  it('does not flag any Datasource* pseudo-var assignment as unused', () => {
    const code = [
      "DatasourceType = 'VIEW';",
      "DatasourceNameForServer = 'Cube';",
      "DatasourceCubeview = 'View';",
      "DatasourceDimensionSubset = 'Sub';",
      "DatasourceODBOCatalog = 'Cat';",
    ].join('\n');
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'unused-variable')).toHaveLength(0);
  });
});

describe('hardcoded-path — fixed file/UNC paths in string literals', () => {
  const lint = (code: string) => {
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed: ' + result.error.message); }
    return lintTiAst(result.ast, undefined, code);
  };

  it('flags a Windows drive path in an assignment', () => {
    const diagnostics = lint("vFile = 'C:\\data\\export.csv';\nProcessQuit;");
    const hits = diagnostics.filter(d => d.ruleId === 'hardcoded-path');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].severity).toBe('warning');
    expect(hits[0].messageArgs).toEqual(["C:\\data\\export.csv"]);
  });

  it('flags a UNC path', () => {
    const diagnostics = lint("vOut = '\\\\fileserver\\share\\out.txt';\nProcessQuit;");
    const hits = diagnostics.filter(d => d.ruleId === 'hardcoded-path');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags a forward-slash drive path', () => {
    const diagnostics = lint("vFile = 'D:/temp/x.csv';\nProcessQuit;");
    expect(diagnostics.filter(d => d.ruleId === 'hardcoded-path')).toHaveLength(1);
  });

  it('no false positive for URLs (http://)', () => {
    const diagnostics = lint("vUrl = 'http://example.com/api';\nProcessQuit;");
    expect(diagnostics.filter(d => d.ruleId === 'hardcoded-path')).toHaveLength(0);
  });

  it('no false positive for time strings (12:34)', () => {
    const diagnostics = lint("vTime = '12:34';\nProcessQuit;");
    expect(diagnostics.filter(d => d.ruleId === 'hardcoded-path')).toHaveLength(0);
  });

  it('ignores paths in comments', () => {
    const diagnostics = lint("# siehe C:\\docs\\readme.txt\nx = 1;\nProcessQuit;");
    expect(diagnostics.filter(d => d.ruleId === 'hardcoded-path')).toHaveLength(0);
  });

  it('no hit without a path literal', () => {
    const diagnostics = lint("x = 1;\ny = x + 1;\nProcessQuit;");
    expect(diagnostics.filter(d => d.ruleId === 'hardcoded-path')).toHaveLength(0);
  });
});

describe('expand-missing — %var% pattern without Expand()', () => {
  const lint = (code: string, options?: { paramNames?: string[]; datasourceVars?: string[] }) => {
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed: ' + result.error.message); }
    return lintTiAst(result.ast, undefined, code, undefined, undefined, options);
  };
  const hits = (code: string, options?: { paramNames?: string[]; datasourceVars?: string[] }) =>
    lint(code, options).filter(d => d.ruleId === 'expand-missing');

  it('fires on a %var% literal as a function argument (variable declared)', () => {
    const h = hits("nValue = 42;\nTextOutput('out.txt', 'Wert: %nValue%');\nProcessQuit;");
    expect(h).toHaveLength(1);
    expect(h[0].line).toBe(2);
    expect(h[0].severity).toBe('warning');
    expect(h[0].messageKey).toBe("String contains '%{0}%' but is not interpolated through Expand().");
    expect(h[0].messageArgs).toEqual(['nValue']);
  });

  it('fires on a %var% literal as assignment RHS', () => {
    const h = hits("sUser = 'Alice';\nsMsg = 'Hallo %sUser%';\nProcessQuit;");
    expect(h).toHaveLength(1);
    expect(h[0].line).toBe(2);
    expect(h[0].messageArgs).toEqual(['sUser']);
  });

  it('does not fire when the literal is inside Expand(...)', () => {
    expect(hits("sUser = 'Alice';\nsMsg = Expand('Hallo %sUser%');\nProcessQuit;")).toHaveLength(0);
    expect(hits("nValue = 42;\nTextOutput('out.txt', Expand('Wert: %nValue%'));\nProcessQuit;")).toHaveLength(0);
  });

  it('does not fire on a concat inside Expand(...)', () => {
    const code = "sX = 'a';\nsUser = 'Bob';\nsMsg = Expand('prefix ' | sX | ' %sUser%');\nProcessQuit;";
    expect(hits(code)).toHaveLength(0);
  });

  it('does not fire when the %name% is not declared anywhere', () => {
    expect(hits("sMsg = '100%foo%bar';\nProcessQuit;")).toHaveLength(0);
  });

  it('does not fire on a single % (50%)', () => {
    expect(hits("nValue = 42;\nsMsg = 'Anteil: 50%';\nProcessQuit;")).toHaveLength(0);
  });

  it('does not fire in comment lines', () => {
    expect(hits("sUser = 'Alice';\n# TextOutput('x', '%sUser%');\nProcessQuit;")).toHaveLength(0);
  });

  it('parameters count as declared: fires outside Expand, not inside', () => {
    const opts = { paramNames: ['pParam'] };
    const outside = hits("sMsg = 'Wert: %pParam%';\nProcessQuit;", opts);
    expect(outside).toHaveLength(1);
    expect(outside[0].line).toBe(1);
    expect(hits("sMsg = Expand('Wert: %pParam%');\nProcessQuit;", opts)).toHaveLength(0);
  });

  it('at most one diagnostic per line with several patterns', () => {
    const h = hits("sA = 'x';\nsB = 'y';\nsMsg = '%sA% und %sB%';\nProcessQuit;");
    expect(h).toHaveLength(1);
    expect(h[0].line).toBe(3);
  });
});

describe('non-ascii-identifier — umlauts in variable names', () => {
  it('parses a variable with an umlaut + emits a hint', () => {
    const code = [
      "käse = 1;",
      "größe = käse + 1;",
      "ProcessQuit;",
    ].join('\n');
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed: ' + result.error.message); }
    const diagnostics = lintTiAst(result.ast);
    const hits = diagnostics.filter(d => d.ruleId === 'non-ascii-identifier');
    expect(hits.map(h => h.messageArgs?.[0])).toEqual(
      expect.arrayContaining(['käse', 'größe']),
    );
    expect(hits.every(h => h.severity === 'hint')).toBe(true);
    expect(hits.every(h => /contains umlauts or ß/.test(h.messageKey ?? ''))).toBe(true);
  });

  it('no hints for pure ASCII variables', () => {
    const code = [
      "x = 1;",
      "y = x + 1;",
    ].join('\n');
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'non-ascii-identifier')).toHaveLength(0);
  });
});

describe('dead-code-condition — Debug-Toggle Pattern (1=0 / 0=1)', () => {
  // Bedrock pattern: `If(1=0); … EndIf;` is a deliberate debug-switch idiom.
  // The linter must not flag it as dead code.
  it('skips dead-code-condition for `1=0`', () => {
    const code = "If(1=0);\n  x = 1;\nEndIf;";
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'dead-code-condition')).toHaveLength(0);
  });

  it('skips dead-code-condition for `0=1`', () => {
    const code = "If(0=1);\n  x = 1;\nEndIf;";
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'dead-code-condition')).toHaveLength(0);
  });

  it('skips dead-code-condition with whitespace `1 = 0`', () => {
    const code = "If(1 = 0);\n  x = 1;\nEndIf;";
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'dead-code-condition')).toHaveLength(0);
  });

  it('still flags non-toggle constant-false condition `2=3`', () => {
    const code = "If(2=3);\n  x = 1;\nEndIf;";
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.some(d => d.ruleId === 'dead-code-condition')).toBe(true);
  });

  it('skips dead-code-condition in ELSEIF debug-toggle `1=0`', () => {
    const code = "If(x > 0);\n  y = 1;\nElseIf(1=0);\n  y = 2;\nEndIf;";
    const result = parseTiCode(code);
    if (!result.ok) { throw new Error('parse failed'); }
    const diagnostics = lintTiAst(result.ast);
    expect(diagnostics.filter(d => d.ruleId === 'dead-code-condition')).toHaveLength(0);
  });
});

describe('bedrockMode — skip noise rules for IBM bedrock files', () => {
  // }bedrock.*.pro are the IBM standard library. unused-var/dead-store are a
  // legacy inheritance we are not going to change anyway — diags are just noise in the Problems panel.
  it('suppresses unused-variable when bedrockMode=true', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'unusedVar', expression: '1', isExternal: false, line: 1 },
    ];
    const diagnostics = lintTiAst(ast, undefined, undefined, undefined, undefined, { bedrockMode: true });
    expect(diagnostics.filter(d => d.ruleId === 'unused-variable')).toHaveLength(0);
  });

  it('suppresses dead-store when bedrockMode=true', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'v', expression: '1', isExternal: false, line: 1 },
      { type: 'assignment', variable: 'v', expression: '2', isExternal: false, line: 2 },
    ];
    const diagnostics = lintTiAst(ast, undefined, undefined, undefined, undefined, { bedrockMode: true });
    expect(diagnostics.filter(d => d.ruleId === 'dead-store')).toHaveLength(0);
  });

  it('still flags unused-variable when bedrockMode=false (default)', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'unusedVar', expression: '1', isExternal: false, line: 1 },
    ];
    const diagnostics = lintTiAst(ast);
    expect(diagnostics.filter(d => d.ruleId === 'unused-variable').length).toBeGreaterThan(0);
  });
});

/**
 * `ElementAttrInsert` and `AttrInsert` are NOT overloads of each other but two
 * functions with a fixed arity — measured live via a compile probe against
 * TM1 11.8 (2026-08-12, attrFamilyAndViewCastProbe.js):
 *
 *   ElementAttrInsert(Dim, Hier, PreviousAttr, Attr, Type)   exactly 5
 *   AttrInsert(Dim, PreviousAttr, Attr, Type)                exactly 4
 *
 * The other arity in each case is a compile error, not a tolerated old
 * format. Previously this said the opposite (`ElementAttrInsert` with 4 arguments
 * "legacy form", `AttrInsert` with 5 "hier-aware") — both assumed without checking.
 */
describe('ElementAttrInsert / AttrInsert — fixed arity (live 11.8)', () => {
  it('accepts ElementAttrInsert with five arguments', () => {
    const ast = parseTiCode("ElementAttrInsert('D', 'H', '', 'NewAttr', 'S');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'wrong-arg-count')).toBeUndefined();
  });

  it('reports ElementAttrInsert with four arguments — the hierarchy is missing', () => {
    const ast = parseTiCode("ElementAttrInsert('D', '', 'NewAttr', 'S');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'wrong-arg-count')).toBeDefined();
  });

  it('reports ElementAttrInsert with six arguments', () => {
    const ast = parseTiCode("ElementAttrInsert('D', 'H', '', 'A', 'S', 'extra');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'wrong-arg-count')).toBeDefined();
  });

  it('accepts AttrInsert with four arguments — without hierarchy', () => {
    const ast = parseTiCode("AttrInsert('D', '', 'NewAttr', 'S');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'wrong-arg-count')).toBeUndefined();
  });

  it('reports AttrInsert with five arguments — that is ElementAttrInsert', () => {
    const ast = parseTiCode("AttrInsert('D', 'H', '', 'NewAttr', 'S');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'wrong-arg-count')).toBeDefined();
  });
});

describe('invalid-arg-value — LogOutput severity literal', () => {
  it('flags a LogOutput severity literal that is not a valid log level', () => {
    const ast = parseTiCode("LogOutput(')FATAL', 'test');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'invalid-arg-value')).toBeDefined();
  });

  it('accepts every valid log level', () => {
    for (const lvl of ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      const ast = parseTiCode(`LogOutput('${lvl}', 'test');`);
      if (!ast.ok) throw new Error('parse failed');
      const diagnostics = lintTiAst(ast.ast);
      expect(diagnostics.find(d => d.ruleId === 'invalid-arg-value')).toBeUndefined();
    }
  });

  it('accepts valid log levels case-insensitively', () => {
    const ast = parseTiCode("LogOutput('info', 'test');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'invalid-arg-value')).toBeUndefined();
  });

  it('does NOT flag a severity passed as a variable (value unknown at lint time)', () => {
    const ast = parseTiCode("LogOutput(vLevel, 'test');");
    if (!ast.ok) throw new Error('parse failed');
    const diagnostics = lintTiAst(ast.ast);
    expect(diagnostics.find(d => d.ruleId === 'invalid-arg-value')).toBeUndefined();
  });
});


describe('findUndefinedVariables — section + real-read line', () => {
  it('anchors to the real read (AST) line/section, not a comment mention on line 1', () => {
    // vFoo appears only in a prolog comment first, then is really read in the
    // epilog. The diagnostic must point at the epilog read, not the comment.
    const sections = {
      prolog: '# vFoo described here\r\nsProc = 1;',
      metadata: '',
      data: '',
      epilog: 'x = 5;\r\ny = vFoo;',
    };
    const undef = findUndefinedVariables(sections, new Set(), new Set());
    const foo = undef.find(u => u.name.toLowerCase() === 'vfoo');
    expect(foo).toBeDefined();
    expect(foo!.section).toBe('epilog');
    expect(foo!.line).toBe(1); // 0-based: second line of the epilog section
  });

  it('does not flag assigned variables', () => {
    const sections = { prolog: 'vBar = 1;\r\ny = vBar;', metadata: '', data: '', epilog: '' };
    const undef = findUndefinedVariables(sections, new Set(), new Set());
    expect(undef.find(u => u.name.toLowerCase() === 'vbar')).toBeUndefined();
  });
});
