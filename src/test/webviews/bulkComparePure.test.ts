import { describe, it, expect } from 'vitest';
import { compareParts, normalizeText, onlyIfBoth, type Parts } from '../../webviews/bulkComparePure';

describe('bulkComparePure', () => {
  it('ignores line endings, trailing spaces and trailing empty lines', () => {
    expect(normalizeText('a  \r\nb\t\r\n\r\n')).toBe('a\nb');
  });

  it('keeps a TI comment heading inside the part it belongs to', () => {
    const a: Parts = [['Prolog', '### Cleanup\nx = 1;'], ['Epilog', '### Cleanup\ny = 1;']];
    const b: Parts = [['Prolog', '### Cleanup\nx = 2;'], ['Epilog', '### Cleanup\ny = 1;']];
    expect(compareParts(a, b)).toEqual({ status: 'differs', parts: ['Prolog'], expected: [] });
  });

  it('drops a part both sides do not report', () => {
    const a: Parts = [['Header', 'h'], ['Execution mode', 'MultipleCommit']];
    const b: Parts = [['Header', 'h']];
    const [x, y] = onlyIfBoth(a, b, 'Execution mode');
    expect(compareParts(x, y).status).toBe('same');
    expect(onlyIfBoth(a, a, 'Execution mode')[0]).toBe(a);
  });

  it('names exactly the parts that differ', () => {
    const a: Parts = [['Prolog', 'x = 1;'], ['Data', 'y = 2;'], ['Epilog', '']];
    const b: Parts = [['Prolog', 'x = 1;\r\n'], ['Data', 'y = 3;'], ['Epilog', '']];
    expect(compareParts(a, b)).toEqual({ status: 'differs', parts: ['Data'], expected: [] });
  });

  it('reports same when only noise differs', () => {
    const a: Parts = [['Rules', 'SKIPCHECK;\n']];
    const b: Parts = [['Rules', 'SKIPCHECK;   \r\n\r\n']];
    expect(compareParts(a, b).status).toBe('same');
  });

  it('counts a part present on one side only', () => {
    const a: Parts = [['Expression', '{[d].[a]}']];
    const b: Parts = [['Elements', 'a']];
    expect(compareParts(a, b).parts).toEqual(['Expression', 'Elements']);
  });

  it('keeps expected parts out of the status', () => {
    const a: Parts = [['Active', 'true'], ['Tasks', '1. p']];
    const b: Parts = [['Active', 'false'], ['Tasks', '1. p']];
    expect(compareParts(a, b, new Set(['Active'])))
      .toEqual({ status: 'same', parts: [], expected: ['Active'] });
  });
});
