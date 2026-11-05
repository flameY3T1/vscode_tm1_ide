import { describe, it, expect } from 'vitest';
import { renameOccurrences } from '../../tiConsistency/scanText';

describe('renameOccurrences', () => {
  it('renames a single occurrence at (line,column)', () => {
    expect(renameOccurrences("f = 'a';", [{ line: 1, column: 1 }], 'x')).toBe("x = 'a';");
  });
  it('renames two occurrences on the same line right-to-left', () => {
    expect(renameOccurrences("f = f | 'b';", [{ line: 1, column: 1 }, { line: 1, column: 5 }], 'xx')).toBe("xx = xx | 'b';");
  });
  it('renames only the listed occurrence, leaving another same-name token alone', () => {
    expect(renameOccurrences("f = f | 'b';", [{ line: 1, column: 5 }], 'x')).toBe("f = x | 'b';");
  });
  it('renames across multiple lines', () => {
    expect(renameOccurrences("f = 'a';\nCellPutS(f, c);", [{ line: 1, column: 1 }, { line: 2, column: 10 }], 'x')).toBe("x = 'a';\nCellPutS(x, c);");
  });
  it('leaves text unchanged when a position is mid-identifier (bad boundary)', () => {
    expect(renameOccurrences("foo = 1;", [{ line: 1, column: 2 }], 'x')).toBe("foo = 1;");
  });
});
