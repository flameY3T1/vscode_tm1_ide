import { describe, it, expect } from 'vitest';
import { filterNames } from '../webviewClient/processEditorMonaco/breakpointCondition';

describe('filterNames', () => {
  it('case-insensitive prefix match', () => {
    expect(filterNames(['vCount', 'vName', 'sX'], 'vc')).toEqual(['vCount']);
  });
  it('empty prefix returns all', () => {
    expect(filterNames(['vCount', 'vName', 'sX'], '')).toEqual(['vCount', 'vName', 'sX']);
  });
  it('no match returns empty', () => {
    expect(filterNames(['vCount', 'vName'], 'z')).toEqual([]);
  });
  it('exact match', () => {
    expect(filterNames(['vCount', 'vName'], 'vcount')).toEqual(['vCount']);
  });
  it('multiple matches preserves order', () => {
    expect(filterNames(['vCount', 'vCity', 'sX'], 'vc')).toEqual(['vCount', 'vCity']);
  });
});
