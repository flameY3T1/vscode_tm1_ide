import { describe, it, expect } from 'vitest';
import { quickFixFor, quickFixesFor, type LineEdit } from '../../webviewClient/processEditorMonaco/quickFixPure';

/** Apply edits to the lines (right to left, single-line or line-joining). */
function apply(lines: string[], edits: LineEdit[]): string[] {
  const text = lines.join('\n');
  const offset = (line: number, col: number) => lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  let out = text;
  for (const e of [...edits].sort((a, b) => offset(b.line, b.startCol) - offset(a.line, a.startCol))) {
    out = out.slice(0, offset(e.line, e.startCol)) + e.text + out.slice(offset(e.endLine ?? e.line, e.endCol));
  }
  return out.split('\n');
}

const fix = (ruleId: string, line: number, lines: string[], messageArgs?: string[]) => {
  const f = quickFixFor({ ruleId, line, messageArgs }, lines);
  return f ? apply(lines, f.edits) : null;
};

describe('missing-semicolon', () => {
  it('goes before a trailing comment', () => {
    expect(fix('missing-semicolon', 1, ['a = 1   # note', 'b = 2;'])).toEqual(['a = 1;   # note', 'b = 2;']);
    // a trailing string literal is code, not blank space
    expect(fix('missing-semicolon', 1, ["s = 'Alice' # note"])).toEqual(["s = 'Alice'; # note"]);
    expect(fix('missing-semicolon', 1, ["s = ''"])).toEqual(["s = '';"]);
    expect(fix('missing-semicolon', 1, ["s = 'it''s # no comment'"])).toEqual(["s = 'it''s # no comment';"]);
  });
  it('follows a call over several lines to its closing bracket', () => {
    expect(fix('missing-semicolon', 1, ["x = Fn('a(',", '  2)', 'b = 1;'])).toEqual(["x = Fn('a(',", '  2);', 'b = 1;']);
  });
});

describe('comparison operators', () => {
  it('turns = into @= and ignores the assignment =', () => {
    expect(fix('string-compare-without-at', 1, ["s = IF(v = 'a', 1, 0);"], ['='])).toEqual(["s = IF(v @= 'a', 1, 0);"]);
  });
  it('turns @<> into <>', () => {
    expect(fix('numeric-compare-with-at', 1, ['IF(n @<> 0);'], ['@<>', '<>'])).toEqual(['IF(n <> 0);']);
  });
  it('offers nothing when the operator occurs twice (which one is meant?)', () => {
    expect(fix('string-compare-without-at', 1, ["IF(a = 'x' & b = 1);"], ['='])).toBeNull();
  });
  it('does not read <= as =', () => {
    expect(fix('string-compare-without-at', 1, ["IF(n <= 1 % s = 'x');"], ['='])).toEqual(["IF(n <= 1 % s @= 'x');"]);
  });
});

describe('inconsistent-var-casing', () => {
  it('renames exact spellings only, not strings, comments or longer names', () => {
    expect(fix('inconsistent-var-casing', 1, ["vcount = vcount + vcountX; # vcount 'vcount'"], ['vcount', 'vCount']))
      .toEqual(["vCount = vCount + vcountX; # vcount 'vcount'"]);
  });
});

describe('unused-variable', () => {
  it('removes the whole line with its line break', () => {
    expect(fix('unused-variable', 2, ['a = 1;', 'x = a * 2;  # tmp', 'b = a;'], ['x'])).toEqual(['a = 1;', 'b = a;']);
  });
  it('removes the last line together with the preceding break', () => {
    expect(fix('unused-variable', 2, ['a = 1;', 'x = 2;'], ['x'])).toEqual(['a = 1;']);
  });
  it('keeps assignments whose right side does something', () => {
    expect(fix('unused-variable', 1, ["n = ExecuteProcess('p');"], ['n'])).toBeNull();
    expect(fix('unused-variable', 1, ["n = DimensionElementInsert('d', '', 'e', 'N');"], ['n'])).toBeNull();
  });
  it('keeps statements that span lines or share a line', () => {
    expect(fix('unused-variable', 1, ['x = Fn(1,', '  2);'], ['x'])).toBeNull();
    expect(fix('unused-variable', 1, ['x = 1; y = 2;'], ['x'])).toBeNull();
  });
});

describe('cube-logging-not-restored', () => {
  const proc = (section: 'prolog' | 'data', prolog: string[], epilog: string[], data: string[] = []) =>
    ({ section, sections: { prolog, metadata: [], data, epilog } });

  it('remembers the setting before switching off and restores it at the end of the epilog', () => {
    const p = proc('prolog', ['a = 1;', "  CubeSetLogChanges('Sales', 0);"], ['x = 1;']);
    const [fix] = quickFixesFor({ ruleId: 'cube-logging-not-restored', line: 2, messageArgs: ["'Sales'"] }, p);
    expect(fix.kind).toBe('restoreCubeLog');
    const prolog = apply(p.sections.prolog, fix.edits.filter(e => !e.section));
    const epilog = apply(p.sections.epilog, fix.edits.filter(e => e.section === 'epilog'));
    expect(prolog).toEqual(['a = 1;', "  nCubeLogBefore = CubeGetLogChanges('Sales');", "  CubeSetLogChanges('Sales', 0);"]);
    expect(epilog).toEqual(['x = 1;', "CubeSetLogChanges('Sales', nCubeLogBefore);"]);
  });
  it('picks a free variable name and writes into an empty epilog without a blank line', () => {
    const p = proc('prolog', ['nCubeLogBefore = 2;', "CubeSetLogChanges(sCube, 0);"], ['']);
    const [fix] = quickFixesFor({ ruleId: 'cube-logging-not-restored', line: 2, messageArgs: ['sCube'] }, p);
    expect(apply(p.sections.epilog, fix.edits.filter(e => e.section === 'epilog'))).toEqual(['CubeSetLogChanges(sCube, nCubeLogBefore2);']);
  });
  it('offers no restore in the data section (runs per record), only the disable', () => {
    const p = proc('data', [], [], ["CubeSetLogChanges('Sales', 0);"]);
    expect(quickFixesFor({ ruleId: 'cube-logging-not-restored', line: 1, messageArgs: ["'Sales'"] }, p).map(f => f.kind)).toEqual(['disableRule']);
  });
});

describe('disable rule for this line', () => {
  const only = (section: string[], line: number, ruleId: string) =>
    quickFixesFor({ ruleId, line }, { section: 'prolog', sections: { prolog: section, metadata: [], data: [], epilog: [] } })
      .find(f => f.kind === 'disableRule');

  it('inserts the directive above with the same indentation, never preferred', () => {
    const lines = ['IF(1=1);', "    ExecuteCommand(s, 1);", 'ENDIF;'];
    const f = only(lines, 2, 'exec-command-forbidden')!;
    expect(f.notPreferred).toBe(true);
    expect(apply(lines, f.edits)).toEqual(['IF(1=1);', '    # tm1lint: disable-next-line=exec-command-forbidden', '    ExecuteCommand(s, 1);', 'ENDIF;']);
  });
  it('extends an existing directive instead of stacking a second one', () => {
    const lines = ['# tm1lint: disable-next-line=hardcoded-path', "ExecuteCommand('c:\\x', 1);"];
    expect(apply(lines, only(lines, 2, 'exec-command-forbidden')!.edits))
      .toEqual(['# tm1lint: disable-next-line=hardcoded-path,exec-command-forbidden', "ExecuteCommand('c:\\x', 1);"]);
  });
  it('is not offered for parser and compile errors', () => {
    expect(only(['a = 1'], 1, 'missing-semicolon')).toBeUndefined();
    expect(only(['a = 1;'], 1, 'tm1-compile')).toBeUndefined();
  });
});
