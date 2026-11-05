import { describe, it, expect } from 'vitest';
import { buildElementsPagePath } from '../tm1Rest/areaDbBuilderRest.pure';

describe('buildElementsPagePath', () => {
  it('no query → no $filter, paged with top=pageSize+1', () => {
    expect(buildElementsPagePath('Region', '', 0, 50)).toBe(
      "Dimensions('Region')/Hierarchies('Region')/Elements?$select=Name,Attributes&$top=51&$skip=0",
    );
  });

  it('query → lowercased contains filter, skip applied', () => {
    expect(buildElementsPagePath('Region', 'Eu', 50, 50)).toBe(
      "Dimensions('Region')/Hierarchies('Region')/Elements?$select=Name,Attributes&$top=51&$skip=50&$filter=contains(tolower(Name),'eu')",
    );
  });

  it('escapes apostrophes in the dim name (OData key) and url-encodes', () => {
    const enc = encodeURIComponent("O''Dim");
    expect(buildElementsPagePath("O'Dim", '', 0, 50)).toBe(
      `Dimensions('${enc}')/Hierarchies('${enc}')/Elements?$select=Name,Attributes&$top=51&$skip=0`,
    );
  });

  it('escapes apostrophes inside the query filter literal', () => {
    expect(buildElementsPagePath('D', "o'x", 0, 50)).toContain(
      "$filter=contains(tolower(Name),'o''x')",
    );
  });

  it('percent-encodes & # % so the search text cannot cut the query string', () => {
    const p = buildElementsPagePath('D', 'R&D #1 50%', 0, 50);
    expect(p).toContain("$filter=contains(tolower(Name),'r%26d%20%231%2050%25')");
    expect(p.split('&')).toHaveLength(4); // $select, $top, $skip, $filter — no stray split
  });
});
