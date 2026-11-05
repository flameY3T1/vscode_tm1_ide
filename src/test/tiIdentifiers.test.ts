import { describe, it, expect } from 'vitest';
import { stripStringsAndComments, collectIdentifierNames } from '../webviewClient/processEditorMonaco/tiIdentifiers';

describe('stripStringsAndComments', () => {
  it('blanks string literals and # comments', () => {
    expect(stripStringsAndComments("vX = 'abc'; # note")).toBe('vX =      ;       ');
  });
  it('handles doubled single-quote escape', () => {
    expect(stripStringsAndComments("s = 'a''b';")).toBe('s =       ;');
  });
});

describe('collectIdentifierNames', () => {
  it('collects user identifiers, drops keywords and builtins', () => {
    const names = collectIdentifierNames(['vCount = 1;\nIF(vCount > 0);\nsName = NUMBERTOSTRING(vCount);\nENDIF;']);
    expect(names).toContain('vCount');
    expect(names).toContain('sName');
    expect(names).not.toContain('IF');
    expect(names).not.toContain('ENDIF');
    expect(names).not.toContain('NUMBERTOSTRING');
  });
  it('dedupes case-insensitively, keeps first casing', () => {
    expect(collectIdentifierNames(['vAaa = 1; vaaa = 2;'])).toEqual(['vAaa']);
  });
});
