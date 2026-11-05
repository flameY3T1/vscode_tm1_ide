import { parseTiCode, parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';
import type {
  TiAssignment,
  TiIfBlock,
  TiWhileBlock,
  TiFunctionCall,
} from '../tiLogicVisualizer/types';

// Helper to assert a successful parse
function parseOk(code: string) {
  const result = parseTiCode(code);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok parse');
  return result.ast;
}

// Helper to assert a failed parse
function parseErr(code: string) {
  const result = parseTiCode(code);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected error parse');
  return result.error;
}

// --- Requirement 1.2: Assignments ---
describe('Assignments (Req 1.2)', () => {
  it('parses a simple assignment', () => {
    const ast = parseOk('x = 42;');
    expect(ast).toHaveLength(1);
    const stmt = ast[0] as TiAssignment;
    expect(stmt.type).toBe('assignment');
    expect(stmt.variable).toBe('x');
    expect(stmt.expression).toBe('42');
    expect(stmt.isExternal).toBe(false);
    expect(stmt.line).toBe(1);
  });

  it('rejects an assignment without trailing semicolon', () => {
    const result = parseTiCode('myVar = someValue');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('semicolon');
    }
  });

  it('parses an assignment with a complex expression', () => {
    const ast = parseOk('result = (a + b) * c;');
    expect(ast).toHaveLength(1);
    const stmt = ast[0] as TiAssignment;
    expect(stmt.variable).toBe('result');
    expect(stmt.expression).toBe('(a + b) * c');
  });
});

// --- Requirement 1.3: CellGetN / CellGetS detection ---
describe('CellGetN/CellGetS detection (Req 1.3)', () => {
  it('detects CellGetN and sets isExternal', () => {
    const ast = parseOk('vValue = CellGetN(\'cube\', \'dim1\', \'elem1\');');
    expect(ast).toHaveLength(1);
    const stmt = ast[0] as TiAssignment;
    expect(stmt.type).toBe('assignment');
    expect(stmt.isExternal).toBe(true);
    expect(stmt.cellGetInfo).toBeDefined();
    expect(stmt.cellGetInfo!.fn).toBe('CellGetN');
    expect(stmt.cellGetInfo!.params).toEqual(["'cube'", "'dim1'", "'elem1'"]);
  });

  it('detects CellGetS and sets isExternal', () => {
    const ast = parseOk('sName = CellGetS(\'cube\', \'dim1\', \'elem1\');');
    const stmt = ast[0] as TiAssignment;
    expect(stmt.isExternal).toBe(true);
    expect(stmt.cellGetInfo!.fn).toBe('CellGetS');
  });

  it('does not set isExternal for regular assignments', () => {
    const ast = parseOk('x = 10;');
    const stmt = ast[0] as TiAssignment;
    expect(stmt.isExternal).toBe(false);
    expect(stmt.cellGetInfo).toBeUndefined();
  });
});

// --- Requirement 1.4: IF/ELSEIF/ELSE/ENDIF blocks ---
describe('IF/ELSEIF/ELSE/ENDIF blocks (Req 1.4)', () => {
  it('parses a simple IF/ENDIF block', () => {
    const code = `IF(x > 0);
  y = 1;
ENDIF;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const ifBlock = ast[0] as TiIfBlock;
    expect(ifBlock.type).toBe('if');
    expect(ifBlock.condition).toBe('x > 0');
    expect(ifBlock.thenBody).toHaveLength(1);
    expect(ifBlock.elseIfClauses).toHaveLength(0);
    expect(ifBlock.elseBody).toHaveLength(0);
    expect(ifBlock.line).toBe(1);
  });

  it('parses IF/ELSE/ENDIF block', () => {
    const code = `IF(a = 1);
  x = 10;
ELSE;
  x = 20;
ENDIF;`;
    const ast = parseOk(code);
    const ifBlock = ast[0] as TiIfBlock;
    expect(ifBlock.thenBody).toHaveLength(1);
    expect(ifBlock.elseBody).toHaveLength(1);
    expect((ifBlock.elseBody[0] as TiAssignment).expression).toBe('20');
  });

  it('parses IF/ELSEIF/ELSE/ENDIF block', () => {
    const code = `IF(a > 10);
  x = 1;
ELSEIF(a > 5);
  x = 2;
ELSE;
  x = 3;
ENDIF;`;
    const ast = parseOk(code);
    const ifBlock = ast[0] as TiIfBlock;
    expect(ifBlock.thenBody).toHaveLength(1);
    expect(ifBlock.elseIfClauses).toHaveLength(1);
    expect(ifBlock.elseIfClauses[0].condition).toBe('a > 5');
    expect(ifBlock.elseIfClauses[0].body).toHaveLength(1);
    expect(ifBlock.elseBody).toHaveLength(1);
  });

  it('parses multiple ELSEIF clauses', () => {
    const code = `IF(a > 100);
  x = 1;
ELSEIF(a > 50);
  x = 2;
ELSEIF(a > 10);
  x = 3;
ELSE;
  x = 4;
ENDIF;`;
    const ast = parseOk(code);
    const ifBlock = ast[0] as TiIfBlock;
    expect(ifBlock.elseIfClauses).toHaveLength(2);
    expect(ifBlock.elseIfClauses[0].condition).toBe('a > 50');
    expect(ifBlock.elseIfClauses[1].condition).toBe('a > 10');
  });
});

// --- Requirement 1.5: WHILE/END loops ---
describe('WHILE/END loops (Req 1.5)', () => {
  it('parses a simple WHILE/END loop', () => {
    const code = `WHILE(i < 10);
  i = i + 1;
END;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const whileBlock = ast[0] as TiWhileBlock;
    expect(whileBlock.type).toBe('while');
    expect(whileBlock.condition).toBe('i < 10');
    expect(whileBlock.body).toHaveLength(1);
    expect(whileBlock.line).toBe(1);
  });

  it('parses a WHILE loop with multiple statements', () => {
    const code = `WHILE(n > 0);
  x = x + n;
  n = n - 1;
END;`;
    const ast = parseOk(code);
    const whileBlock = ast[0] as TiWhileBlock;
    expect(whileBlock.body).toHaveLength(2);
  });
});

// --- Requirement 1.1: Function calls ---
describe('Function calls (Req 1.1)', () => {
  it('parses a function call with arguments', () => {
    const ast = parseOk("CellPutN(42, 'cube', 'dim1', 'elem1');");
    expect(ast).toHaveLength(1);
    const call = ast[0] as TiFunctionCall;
    expect(call.type).toBe('functionCall');
    expect(call.name).toBe('CellPutN');
    expect(call.args).toHaveLength(4);
    expect(call.args[0]).toBe('42');
  });

  it('parses a function call with no arguments', () => {
    parseOk('ProcessBreak;');
    // ProcessBreak without parens may not match function call pattern
    // Let's test with parens
    const ast2 = parseOk('ProcessBreak();');
    expect(ast2).toHaveLength(1);
    const call = ast2[0] as TiFunctionCall;
    expect(call.type).toBe('functionCall');
    expect(call.name).toBe('ProcessBreak');
    expect(call.args).toHaveLength(0);
  });

  it('accepts bare 0-arg void TI builtins without parens (ChoreQuit, SaveDataAll, ForceSkipCheck)', () => {
    for (const name of ['ChoreQuit', 'SaveDataAll', 'ForceSkipCheck']) {
      const ast = parseOk(`${name};`);
      expect(ast).toHaveLength(1);
      const call = ast[0] as TiFunctionCall;
      expect(call.type).toBe('functionCall');
      expect(call.name).toBe(name);
      expect(call.args).toHaveLength(0);
    }
  });

  it('accepts bare Break; (loop-exit keyword) inside a While block without cascading parse errors', () => {
    const code = [
      'While ( i < 10 );',
      '  If ( cond = 1 );',
      '    Break;',
      '  EndIf;',
      '  i = i + 1;',
      'End;',
    ].join('\n');
    const { ast, errors } = parseTiCodeAccumulating(code);
    expect(errors).toEqual([]);
    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('while');
  });

  it('parses a function call with nested parentheses in args', () => {
    const ast = parseOk("LogOutput('INFO', NumberToString(x));");
    expect(ast).toHaveLength(1);
    const call = ast[0] as TiFunctionCall;
    expect(call.type).toBe('functionCall');
    expect(call.name).toBe('LogOutput');
    expect(call.args).toHaveLength(2);
  });

  it('parses a function call with a close-paren inside a string literal arg', () => {
    // The outer-paren matcher must skip ')' that lives inside a quoted
    // string, otherwise it closes the arg list early.
    const ast = parseOk("LogOutput(')FATAL', 'test');");
    expect(ast).toHaveLength(1);
    const call = ast[0] as TiFunctionCall;
    expect(call.type).toBe('functionCall');
    expect(call.name).toBe('LogOutput');
    expect(call.args).toEqual(["')FATAL'", "'test'"]);
  });

  it("parses top-level 3-arg IF expression as a function call (not a block opener)", () => {
    // TI builtin ternary IF: `IF(cond, true_value, false_value)` is a
    // value-returning expression that some code uses bare for its side
    // effect (e.g. `IF(v@='', ItemSkip, 0);`). Must NOT be treated as the
    // start of a multi-line IF/ENDIF block.
    const ast = parseOk("IF(vsVAR@='', ItemSkip, 0);");
    expect(ast).toHaveLength(1);
    const call = ast[0] as TiFunctionCall;
    expect(call.type).toBe('functionCall');
    expect(call.name).toBe('IF');
    expect(call.args).toEqual(["vsVAR@=''", 'ItemSkip', '0']);
  });

  it('still parses 1-arg IF(cond); as a block opener (needs ENDIF)', () => {
    // Guard against the ternary-detector swallowing block-form IF.
    const code = `IF(x > 0);
  y = 1;
ENDIF;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('if');
  });
});

// --- Requirement 1.7: Comments are ignored ---
describe('Comments (Req 1.7)', () => {
  it('skips comment lines', () => {
    const code = `# This is a comment
x = 1;
# Another comment
y = 2;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(2);
    expect((ast[0] as TiAssignment).variable).toBe('x');
    expect((ast[1] as TiAssignment).variable).toBe('y');
  });

  it('skips inline comment-only lines mixed with code', () => {
    const code = `x = 1;
#
# comment block
#
y = 2;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(2);
  });
});

// --- Requirement 1.6: Error cases ---
describe('Error cases (Req 1.6)', () => {
  it('returns error for missing ENDIF', () => {
    const code = `IF(x > 0);
  y = 1;`;
    const error = parseErr(code);
    expect(error.line).toBeGreaterThan(0);
    expect(error.message).toContain('ENDIF');
  });

  it('returns error for missing END in WHILE', () => {
    const code = `WHILE(i < 10);
  i = i + 1;`;
    const error = parseErr(code);
    expect(error.line).toBeGreaterThan(0);
    expect(error.message).toContain('END');
  });

  it('returns error for unexpected ENDIF without IF', () => {
    const code = `x = 1;
ENDIF;`;
    const error = parseErr(code);
    expect(error.line).toBe(2);
    expect(error.message).toContain('ENDIF');
  });

  it('returns error for unexpected END without WHILE', () => {
    const code = `x = 1;
END;`;
    const error = parseErr(code);
    expect(error.line).toBe(2);
    expect(error.message).toContain('END');
  });
});

// --- Edge cases ---
describe('Edge cases', () => {
  it('handles empty code', () => {
    const ast = parseOk('');
    expect(ast).toHaveLength(0);
  });

  it('handles code with only comments', () => {
    const code = `# comment 1
# comment 2
# comment 3`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(0);
  });

  it('handles code with only blank lines', () => {
    const ast = parseOk('\n\n\n');
    expect(ast).toHaveLength(0);
  });

  it('handles nested IF blocks', () => {
    const code = `IF(a > 0);
  IF(b > 0);
    x = 1;
  ELSE;
    x = 2;
  ENDIF;
ENDIF;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const outer = ast[0] as TiIfBlock;
    expect(outer.type).toBe('if');
    expect(outer.thenBody).toHaveLength(1);
    const inner = outer.thenBody[0] as TiIfBlock;
    expect(inner.type).toBe('if');
    expect(inner.condition).toBe('b > 0');
    expect(inner.thenBody).toHaveLength(1);
    expect(inner.elseBody).toHaveLength(1);
  });

  it('handles nested WHILE inside IF', () => {
    const code = `IF(flag = 1);
  WHILE(i < 5);
    i = i + 1;
  END;
ENDIF;`;
    const ast = parseOk(code);
    const ifBlock = ast[0] as TiIfBlock;
    expect(ifBlock.thenBody).toHaveLength(1);
    const whileBlock = ifBlock.thenBody[0] as TiWhileBlock;
    expect(whileBlock.type).toBe('while');
    expect(whileBlock.condition).toBe('i < 5');
  });

  it('handles IF inside WHILE', () => {
    const code = `WHILE(i < 10);
  IF(i > 5);
    x = 1;
  ENDIF;
  i = i + 1;
END;`;
    const ast = parseOk(code);
    const whileBlock = ast[0] as TiWhileBlock;
    expect(whileBlock.body).toHaveLength(2);
    expect(whileBlock.body[0].type).toBe('if');
    expect(whileBlock.body[1].type).toBe('assignment');
  });

  it('parses multiple top-level statements', () => {
    const code = `x = 1;
y = 2;
CellPutN(x, 'cube', 'dim');
IF(x > 0);
  z = 3;
ENDIF;`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(4);
    expect(ast[0].type).toBe('assignment');
    expect(ast[1].type).toBe('assignment');
    expect(ast[2].type).toBe('functionCall');
    expect(ast[3].type).toBe('if');
  });

  it('handles ENDIF and END without semicolons', () => {
    const code = `IF(x > 0);
  y = 1;
ENDIF`;
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('if');
  });
});

// ─── Multi-line string literals ──────────────────────────────────────────────

describe('multi-line string literals', () => {
  it('parses assignment with multi-line MDX string literal', () => {
    const code = [
      "vMdx = '{",
      "  [Dim].[Hier].[Elem1],",
      "  [Dim].[Hier].[Elem2]",
      "}';",
      "vCube = 'TheCube';",
      "vRet = CellPutN(1, vCube, 'a', 'b');",
    ].join('\n');
    const ast = parseOk(code);
    // Both assignments + the function call must survive parsing
    expect(ast.length).toBeGreaterThanOrEqual(3);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'vmdx')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'vcube')).toBeDefined();
  });

  it('does not lose subsequent assignments after multi-line string', () => {
    const code = [
      "x = '{",
      "line2",
      "line3 with # not a comment",
      "}';",
      "y = 42;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'y')).toBeDefined();
  });

  it('handles blank lines inside multi-line string', () => {
    const code = [
      "msg = 'Line1",
      "",
      "Line3';",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('joins assignment with bare = and string literal on next line', () => {
    const code = [
      "vMdx =",
      "'{ MDX content }';",
      "vAfter = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'vmdx')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'vafter')).toBeDefined();
  });

  it('joins assignment with bare = and multi-line string on next lines', () => {
    const code = [
      "vMdx =",
      "'{",
      "  body",
      "}';",
      "sCube_Target = pCube_Target;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'vmdx')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'scube_target')).toBeDefined();
  });

  it('joins string-concat continuation across lines (trailing |)', () => {
    const code = [
      "vS = 'a' |",
      "     'b' |",
      "     'c';",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'vs')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('joins string-concat continuation across lines (leading |)', () => {
    // Bedrock idiom: operator at the start of the continuation line, not at the end of the previous line.
    // Real example from }bedrock.cube.data.copy.intercube.pro.
    const code = [
      "sTgtDimString = '^^'|sDim1|'^^'|sDim2|'^^'",
      "                |sDim3|'^^'|sDim4|'^^'",
      "                |sDim5|'^^';",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'stgtdimstring')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('joins arithmetic continuation with backslash division (TM1 divide op) after a closing-paren line', () => {
    // TM1's division operator can be backslash '\' (divide-by-zero → 0, no error)
    // as well as '/'. A statement whose closing ')' sits on its own line and
    // continues via '\' on the next line must join, not split into broken
    // per-line statements.
    const code = [
      "nVal = (CellGetN('C','a','b') +",
      "        CellGetN('C','a','c')",
      ")",
      "       \\ nDiv;",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'nval')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('joins arithmetic continuation with a leading subtraction operator', () => {
    const code = [
      "nVal = (nA",
      "        - nB)",
      "       - nC;",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'nval')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('joins a multi-line string that is a concat segment (string closes mid-statement)', () => {
    // Real idiom: MDX built as 'literal spanning\nmany lines' | var | 'more\nlines';
    // The first string literal closes mid-statement (at depth 0) but the
    // assignment continues via `| var | '…'` on the following lines.
    const code = [
      "sMDXDelete = ",
      "  'SELECT ",
      "  NON EMPTY ",
      "      {TM1FILTERBYLEVEL({TM1SUBSETALL([Dim].[Dim])}, 0)} * '",
      "      | sMDXJahr | ' *",
      "      {[Konten].[' | csKonten | ']} *",
      "  ON ROWS ",
      "  FROM ",
      "    [' | csCube | '] ",
      "  WHERE ",
      "    (",
      "    [datenart].[datenart].[Plan]",
      "    )';",
      "after = 1;",
    ].join('\n');
    const ast = parseOk(code);
    const assigns = ast.filter(s => s.type === 'assignment') as TiAssignment[];
    expect(assigns.find(a => a.variable.toLowerCase() === 'smdxdelete')).toBeDefined();
    expect(assigns.find(a => a.variable.toLowerCase() === 'after')).toBeDefined();
  });

  it('does not join lines on bare comparison operators (==, <>, <=)', () => {
    const code = [
      "IF(x == 1);",
      "  y = 1;",
      "ENDIF;",
    ].join('\n');
    parseOk(code); // must not hang or absorb following lines
  });
});

describe('Block terminators with a space before the semicolon', () => {
  it('accepts "EndIf ;" / "Else ;" / "End ;"', () => {
    const code = [
      "IF(nValid = 1);",
      "  ASCIIOutput('a.log', 'Ja');",
      "Else ;",
      "  ASCIIOutput('a.log', 'Nein');",
      "  ProcessQuit;",
      "EndIf ;",
      "WHILE(n < 5);",
      "  n = n + 1;",
      "End ;",
    ].join('\n');
    const ast = parseOk(code);
    expect(ast.length).toBe(2);
    expect(ast[0].type).toBe('if');
    expect(ast[1].type).toBe('while');
  });
});

describe('Multi-Statement Single-Line (depth-0 ; splits)', () => {
  it('parses several statements on one line separated by ;', () => {
    const code = "x = 1; y = 2; CellPutN(x, 'cube', 'a');";
    const ast = parseOk(code);
    expect(ast).toHaveLength(3);
    expect(ast[0].type).toBe('assignment');
    expect((ast[0] as TiAssignment).variable).toBe('x');
    expect(ast[1].type).toBe('assignment');
    expect((ast[1] as TiAssignment).variable).toBe('y');
    expect(ast[2].type).toBe('functionCall');
  });

  it('parses a function call followed by assignments on one line', () => {
    const code = "StringGlobalVariable('s');s='}A';sep='_&_';val=CellGetS('c','d','e');";
    const ast = parseOk(code);
    expect(ast).toHaveLength(4);
    expect(ast[0].type).toBe('functionCall');
    expect((ast[0] as TiFunctionCall).name).toBe('StringGlobalVariable');
    expect(ast[1].type).toBe('assignment');
    expect(ast[2].type).toBe('assignment');
    expect(ast[3].type).toBe('assignment');
  });

  it('parses an inline IF embedded in a multi-statement line', () => {
    const code = "a=1;If(a@='');a=Default;EndIf;b=2;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(3);
    expect(ast[0].type).toBe('assignment');
    expect((ast[0] as TiAssignment).variable).toBe('a');
    expect(ast[1].type).toBe('if');
    const ifBlk = ast[1] as TiIfBlock;
    expect(ifBlk.thenBody).toHaveLength(1);
    expect(ast[2].type).toBe('assignment');
    expect((ast[2] as TiAssignment).variable).toBe('b');
  });

  it('does not count strings with semicolons as statement separators', () => {
    const code = "x = 'a;b;c'; y = 2;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(2);
    expect((ast[0] as TiAssignment).expression).toBe("'a;b;c'");
    expect((ast[1] as TiAssignment).variable).toBe('y');
  });
});

describe('Single-line IF with inline ELSEIF/ELSE', () => {
  it('parses IF/ELSEIF/ENDIF on one line', () => {
    const code = "If(p @= '1');s='';ElseIf(p @<>'1');s=p;EndIf;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const ifBlk = ast[0] as TiIfBlock;
    expect(ifBlk.type).toBe('if');
    expect(ifBlk.thenBody).toHaveLength(1);
    expect(ifBlk.elseIfClauses).toHaveLength(1);
    expect(ifBlk.elseIfClauses[0].condition).toContain("p @<>'1'");
    expect(ifBlk.elseIfClauses[0].body).toHaveLength(1);
  });

  it('parses IF/ELSE/ENDIF on one line', () => {
    const code = "IF(x = 0);y = 1;ELSE;y = 2;ENDIF;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const ifBlk = ast[0] as TiIfBlock;
    expect(ifBlk.thenBody).toHaveLength(1);
    expect(ifBlk.elseBody).toHaveLength(1);
  });

  it('parses several inline ELSEIFs', () => {
    const code = "IF(a > 100);x=1;ELSEIF(a > 50);x=2;ELSEIF(a > 10);x=3;ELSE;x=4;ENDIF;";
    const ast = parseOk(code);
    const ifBlk = ast[0] as TiIfBlock;
    expect(ifBlk.elseIfClauses).toHaveLength(2);
    expect(ifBlk.elseBody).toHaveLength(1);
  });
});

describe('Single-Line WHILE/END inline', () => {
  it('parses WHILE/END on one line', () => {
    const code = "While(s @= '');s = NumberToString(1);End;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const w = ast[0] as TiWhileBlock;
    expect(w.type).toBe('while');
    expect(w.body).toHaveLength(1);
  });

  it('parses an inline WHILE with an embedded inline IF in the body', () => {
    const code = "While(i < 5);If(i = 0);x=1;EndIf;i = i + 1;End;";
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    const w = ast[0] as TiWhileBlock;
    expect(w.body).toHaveLength(2);
    expect(w.body[0].type).toBe('if');
    expect(w.body[1].type).toBe('assignment');
  });
});

describe('Real custom TI block (nested multi-stmt + inline IF/ELSEIF + WHILE)', () => {
  it('parses the ProcessExecutionContextID block without errors', () => {
    const code = [
      "If( pDoProcessLogging @<> '0' );",
      "  StringGlobalVariable('sCtxID');sCub='}A';sSep='_&_';sIDStr=CellGetS(sCub,'a','b');If(sIDStr@='');sIDStr=sSep;EndIf;",
      "  If(pCtx @= '1');sCtxID='';ElseIf(pCtx @<>'1' & pCtx @<>'0' & pCtx @<>'');sCtxID=pCtx;sAll=CellGetS(sCub,'a','c');sNew=sAll|sIDStr|sCtxID;CellPutS(sNew,sCub,'a','c');EndIf;",
      "  While(sCtxID@='');sCtxID=NumberToString(INT(RAND()*100000000))|NumberToString(INT(RAND()*100000000));sCtxID=TimSt(Now(),'\\Y\\m\\d')|Fill('0',16-Long(sCtxID))|sCtxID;",
      "  sAll=CellGetS(sCub,'a','c');If(Scan(sCtxID,sAll)=0&DimIx('D',sCtxID)=0);sNew=sAll|sIDStr|sCtxID;CellPutS(sNew,sCub,'a','c');ELSE;sCtxID='';ENDIF;End;",
      "EndIf;",
    ].join('\n');
    const ast = parseOk(code);
    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('if');
  });
});

describe('parseTiCodeAccumulating: line numbers after a parse error', () => {
  // The recovery parses a SLICE starting at the error line, and the parser
  // counts from 1 again there. Without converting back, every rescued statement
  // carried a slice-relative line — so after the first error of a section
  // EVERY lint diagnostic pointed at the wrong place (measured 2026-08-31).
  const BROKEN = '???;';

  it('converts the offset back for top-level statements', () => {
    const code = ['nA = 1;', 'nB = 2;', BROKEN, 'nC = 3;', 'nD = 4;'].join('\n');
    const { ast, errors } = parseTiCodeAccumulating(code);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
    expect(ast.map(s => s.line)).toEqual([1, 2, 4, 5]);
  });

  it('converts the offset back into blocks', () => {
    const code = [
      BROKEN,              // 1
      'IF( nA = 1 );',     // 2
      '  nC = 3;',         // 3
      'ELSEIF( nA = 2 );', // 4
      '  nD = 4;',         // 5
      'ELSE;',             // 6
      '  nE = 5;',         // 7
      'ENDIF;',            // 8
    ].join('\n');
    const { ast, errors } = parseTiCodeAccumulating(code);
    expect(errors).toHaveLength(1);
    expect(ast).toHaveLength(1);
    const blk = ast[0] as TiIfBlock;
    expect(blk.type).toBe('if');
    expect(blk.line).toBe(2);
    expect(blk.thenBody.map(s => s.line)).toEqual([3]);
    expect(blk.elseIfClauses).toHaveLength(1);
    expect(blk.elseIfClauses[0].line).toBe(4);
    expect(blk.elseIfClauses[0].body.map(s => s.line)).toEqual([5]);
    expect(blk.elseBody.map(s => s.line)).toEqual([7]);
  });

  it('converts the offset back into a WHILE body', () => {
    const code = [
      BROKEN,             // 1
      'WHILE( nA < 3 );', // 2
      '  nA = nA + 1;',   // 3
      'END;',             // 4
    ].join('\n');
    const { ast } = parseTiCodeAccumulating(code);
    expect(ast).toHaveLength(1);
    const loop = ast[0] as TiWhileBlock;
    expect(loop.type).toBe('while');
    expect(loop.line).toBe(2);
    expect(loop.body.map(s => s.line)).toEqual([3]);
  });

  it('leaves error-free code unchanged (no offset without errors)', () => {
    const { ast, errors } = parseTiCodeAccumulating(['nA = 1;', 'nB = 2;', 'nC = 3;'].join('\n'));
    expect(errors).toEqual([]);
    expect(ast.map(s => s.line)).toEqual([1, 2, 3]);
  });

  it('also converts back correctly after TWO errors', () => {
    const code = ['nA = 1;', BROKEN, 'nB = 2;', BROKEN, 'nC = 3;'].join('\n');
    const { ast, errors } = parseTiCodeAccumulating(code);
    expect(errors.map(e => e.line)).toEqual([2, 4]);
    expect(ast.map(s => s.line)).toEqual([1, 3, 5]);
  });
});
