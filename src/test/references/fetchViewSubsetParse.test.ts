import { describe, it, expect } from 'vitest';
import { parseSubsetsResponse, parseMdxViewNames } from '../../references/referenceIndexService';

describe('parseSubsetsResponse', () => {
  it('flattens Dimensions→Hierarchies→Subsets with Expression', () => {
    const json = { value: [
      { Name: 'Region', Hierarchies: [
        { Name: 'Region', Subsets: [
          { Name: 'Europe', Expression: null },
          { Name: 'Dyn', Expression: '{[Region].Members}' },
        ] },
      ] },
    ] };
    expect(parseSubsetsResponse(json)).toEqual([
      { dim: 'Region', hier: 'Region', subset: 'Europe', expression: null },
      { dim: 'Region', hier: 'Region', subset: 'Dyn', expression: '{[Region].Members}' },
    ]);
  });
  it('tolerates missing arrays', () => {
    expect(parseSubsetsResponse({})).toEqual([]);
  });
});

describe('parseMdxViewNames', () => {
  it('returns only names of views whose @odata.type is MDXView', () => {
    const json = { value: [
      { Name: 'MdxV', '@odata.type': '#ibm.tm1.api.v1.MDXView' },
      { Name: 'NativeV' },
      { Name: 'OtherMdx', '@odata.type': '#ibm.tm1.api.v1.MDXView' },
    ] };
    expect(parseMdxViewNames(json)).toEqual(['MdxV', 'OtherMdx']);
  });
  it('tolerates missing value', () => {
    expect(parseMdxViewNames({})).toEqual([]);
  });
});
