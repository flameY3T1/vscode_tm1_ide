import { describe, it, expect } from 'vitest';
import { classifyWriteError } from '../../cubeViewer/cellWrite';

const err = (code: string, message: string) => JSON.stringify({ error: { code, message } });

describe('classifyWriteError and picklists', () => {
  it('always recognizes 243 ValueNotInPickList as a picklist violation', () => {
    expect(classifyWriteError(400, err('243', 'ValueNotInPickList')).kind).toBe('picklist');
  });

  it('interprets 285 as a violation only with a known picklist', () => {
    expect(classifyWriteError(400, err('285', 'StringCellUpdateError'), true).kind).toBe('picklist');
  });

  it('leaves 285 without a picklist as validation', () => {
    // 285 can also mean something else — do not over-interpret.
    expect(classifyWriteError(400, err('285', 'StringCellUpdateError'), false).kind).toBe('validation');
    expect(classifyWriteError(400, err('285', 'StringCellUpdateError')).kind).toBe('validation');
  });

  it('leaves spread errors untouched', () => {
    expect(classifyWriteError(400, err('0', 'DataSpreadFailed'), true).kind).toBe('spread-failed');
  });
});
