import { describe, it, expect } from 'vitest';
import {
  dimensionToken, tiEscape,
  buildSetDefaultMemberTi, buildExplicitReadMdx,
} from '../tm1Rest/defaultMemberPure';

describe('dimensionToken', () => {
  it('returns the bare dimension name for the hierarchy of the same name', () => {
    expect(dimensionToken('Kosten', 'Kosten')).toBe('Kosten');
  });

  it('compares case-insensitively — TM1 names are too', () => {
    expect(dimensionToken('Kosten', 'kosten')).toBe('Kosten');
  });

  it('returns dim:hier for every other hierarchy', () => {
    expect(dimensionToken('Kosten', 'Leaves')).toBe('Kosten:Leaves');
    expect(dimensionToken('Kosten', 'alt')).toBe('Kosten:alt');
  });
});

describe('tiEscape', () => {
  it('doubles single quotes', () => {
    expect(tiEscape("O'Brien")).toBe("O''Brien");
  });

  it('leaves square brackets and umlauts untouched', () => {
    expect(tiEscape('Ün]ïcödé')).toBe('Ün]ïcödé');
  });
});

describe('buildSetDefaultMemberTi', () => {
  it('writes the cell and activates with the same token', () => {
    const ti = buildSetDefaultMemberTi('Kosten:alt', 'A');
    expect(ti).toBe(
      "CellPutS('A','}HierarchyProperties','Kosten:alt','hierarchy0','defaultMember');\r\n"
      + "RefreshMdxHierarchy('Kosten:alt');",
    );
  });

  it('resets with the empty string — not an omitted call', () => {
    const ti = buildSetDefaultMemberTi('Kosten', '');
    expect(ti).toContain("CellPutS('','}HierarchyProperties','Kosten','hierarchy0','defaultMember');");
    expect(ti).toContain("RefreshMdxHierarchy('Kosten');");
  });

  it('escapes quotes in element AND token', () => {
    const ti = buildSetDefaultMemberTi("Di'm:hi'er", "O'Br]ien & Söhne");
    expect(ti).toContain("CellPutS('O''Br]ien & Söhne','}HierarchyProperties','Di''m:hi''er','hierarchy0','defaultMember');");
    expect(ti).toContain("RefreshMdxHierarchy('Di''m:hi''er');");
  });
});

describe('buildExplicitReadMdx', () => {
  it('puts all tokens on the row axis, defaultMember on the column axis', () => {
    expect(buildExplicitReadMdx(['Kosten', 'Kosten:alt'])).toBe(
      'SELECT {[}HierarchyProperties].[defaultMember]} ON 0, '
      + '{[}Dimensions].[Kosten],[}Dimensions].[Kosten:alt]} ON 1 '
      + 'FROM [}HierarchyProperties] WHERE ([}Hierarchies].[hierarchy0])',
    );
  });

  it('escapes square brackets in the token', () => {
    expect(buildExplicitReadMdx(['a]b'])).toContain('[}Dimensions].[a]]b]');
  });

  it('throws on an empty token list instead of building an invalid MDX', () => {
    expect(() => buildExplicitReadMdx([])).toThrow(/empty/i);
  });
});
