import { describe, it, expect } from 'vitest';
import {
  processCallTargetAt,
  findProcessCallTargets,
  firstArgIdentifierAt,
  resolveVarLiteral,
} from '../webviewClient/processEditorMonaco/processNavPure';

describe('processCallTargetAt — Ctrl+click go-to-process', () => {
  const line = "ExecuteProcess('Load.Actuals', 'pYear', vYear);";
  // 'Load.Actuals' content starts at col 17 ('L'), closing quote at col 29.

  it('resolves a click inside the name literal', () => {
    expect(processCallTargetAt(line, 20)).toBe('Load.Actuals');
  });

  it('resolves a click on the opening quote', () => {
    expect(processCallTargetAt(line, 16)).toBe('Load.Actuals');
  });

  it('resolves a click on the closing quote', () => {
    expect(processCallTargetAt(line, 29)).toBe('Load.Actuals');
  });

  it('returns null before the name literal (on the function keyword)', () => {
    expect(processCallTargetAt(line, 3)).toBeNull();
  });

  it('returns null inside a later parameter argument', () => {
    // 'pYear' second arg — not a process navigation target.
    expect(processCallTargetAt(line, 35)).toBeNull();
  });

  it('is case-insensitive on the function name', () => {
    expect(processCallTargetAt("executeprocess('Foo');", 18)).toBe('Foo');
  });

  it('handles RunProcess alias', () => {
    expect(processCallTargetAt("RunProcess('Bar');", 14)).toBe('Bar');
  });

  it('handles leading whitespace / indentation', () => {
    const l = "    ExecuteProcess ( 'Deep.Nested' );";
    expect(findProcessCallTargets(l)[0].name).toBe('Deep.Nested');
  });

  it('returns null when the process name is a variable (dynamic)', () => {
    expect(processCallTargetAt('ExecuteProcess(vProc, pY);', 18)).toBeNull();
  });

  it('unescapes doubled single-quotes in the name', () => {
    // Contrived but defensive: '' → '
    expect(processCallTargetAt("ExecuteProcess('It''s');", 18)).toBe("It's");
  });

  it('ignores an unterminated string literal', () => {
    expect(findProcessCallTargets("ExecuteProcess('oops")).toHaveLength(0);
  });

  it('picks the right call when two are on one line', () => {
    const l = "IF(1=1);ExecuteProcess('A');ELSE;ExecuteProcess('B');ENDIF;";
    const first = l.indexOf("'A'") + 2;   // inside 'A'
    const second = l.indexOf("'B'") + 2;  // inside 'B'
    expect(processCallTargetAt(l, first)).toBe('A');
    expect(processCallTargetAt(l, second)).toBe('B');
  });

  it('does not match other functions', () => {
    expect(processCallTargetAt("CellPutN(1,'Cube','Dim');", 15)).toBeNull();
  });

  // Literal path must NOT claim a variable first-arg.
  it('processCallTargetAt returns null for a variable first-arg', () => {
    expect(processCallTargetAt('ExecuteProcess(sProcess, 1);', 18)).toBeNull();
  });
});

describe('firstArgIdentifierAt — variable process-name calls', () => {
  const line = 'ExecuteProcess(sProcess, 1);';
  // 'sProcess' starts at col 16, ends at col 23.

  it('returns the identifier when the column is on it', () => {
    expect(firstArgIdentifierAt(line, 18)).toBe('sProcess');
  });

  it('resolves on the first and last char of the identifier', () => {
    expect(firstArgIdentifierAt(line, 16)).toBe('sProcess');
    expect(firstArgIdentifierAt(line, 23)).toBe('sProcess');
  });

  it('returns null when the first arg is a string literal', () => {
    expect(firstArgIdentifierAt("ExecuteProcess('Foo', 1);", 18)).toBeNull();
  });

  it('returns null outside the identifier', () => {
    expect(firstArgIdentifierAt(line, 3)).toBeNull();  // on the keyword
    expect(firstArgIdentifierAt(line, 26)).toBeNull(); // on the 2nd arg
  });

  it('handles RunProcess and whitespace', () => {
    expect(firstArgIdentifierAt('RunProcess ( vProc );', 15)).toBe('vProc');
  });
});

describe('resolveVarLiteral — nearest string-literal assignment', () => {
  it('resolves a single assignment', () => {
    expect(resolveVarLiteral('sProcess', ["sProcess = '##sleep';"])).toBe('##sleep');
  });

  it('is case-insensitive on the variable name', () => {
    expect(resolveVarLiteral('SPROCESS', ["sProcess = 'Load';"])).toBe('Load');
  });

  it('takes the LAST assignment before the use site', () => {
    const lines = ["sProcess = 'First';", "vX = 1;", "sProcess = 'Second';"];
    expect(resolveVarLiteral('sProcess', lines)).toBe('Second');
  });

  it('resolves across sections (Prolog-assigned, Data-used)', () => {
    // caller concatenates earlier-section lines ahead of the use site.
    const lines = ["# prolog", "sProc = 'CrossSection';", "# data", "ExecuteProcess(sProc);"];
    expect(resolveVarLiteral('sProc', lines)).toBe('CrossSection');
  });

  it('unescapes doubled quotes', () => {
    expect(resolveVarLiteral('v', ["v = 'a''b';"])).toBe("a'b");
  });

  it('returns null when the RHS is not a pure literal (concat)', () => {
    expect(resolveVarLiteral('s', ["s = 'a' | 'b';"])).toBeNull();
  });

  it('returns null when there is no assignment', () => {
    expect(resolveVarLiteral('s', ["nOther = 5;"])).toBeNull();
  });

  it('returns null for an empty-string literal', () => {
    expect(resolveVarLiteral('s', ["s = '';"])).toBeNull();
  });

  it('ignores an assignment that is part of a larger expression line', () => {
    // Not a standalone assignment — must not match.
    expect(resolveVarLiteral('s', ["IF( s = 'x' );"])).toBeNull();
  });
});
