import { describe, it, expect } from 'vitest';
import {
  parseLintSuppressions,
  isLintSuppressed,
  filterSuppressed,
} from '../../tiLogicVisualizer/tiLinter/lintSuppressPure';

describe('parseLintSuppressions', () => {
  it('finds no directive in ordinary code', () => {
    expect(parseLintSuppressions('nA = 1;\n# ein Kommentar\nnB = 2;').size).toBe(0);
  });

  it('binds `disable` to its own line', () => {
    const m = parseLintSuppressions('nA = 1;\nExecuteCommand(sC, 1); # tm1lint: disable=exec-command-forbidden');
    expect(isLintSuppressed(m, 1, 'exec-command-forbidden')).toBe(true);
    expect(isLintSuppressed(m, 0, 'exec-command-forbidden')).toBe(false);
    expect(isLintSuppressed(m, 1, 'hardcoded-path')).toBe(false);
  });

  it('binds `disable-next-line` to the next line', () => {
    const m = parseLintSuppressions('# tm1lint: disable-next-line=hardcoded-path\nsP = 1;');
    expect(isLintSuppressed(m, 1, 'hardcoded-path')).toBe(true);
    expect(isLintSuppressed(m, 0, 'hardcoded-path')).toBe(false);
  });

  it('without a rule list the line is silenced completely', () => {
    const m = parseLintSuppressions('nA = 1; # tm1lint: disable');
    expect(isLintSuppressed(m, 0, 'dead-store')).toBe(true);
    expect(isLintSuppressed(m, 0, 'was-auch-immer')).toBe(true);
  });

  it('takes several rules separated by commas', () => {
    const m = parseLintSuppressions('nA = 1; # tm1lint: disable=dead-store, unused-variable');
    expect(isLintSuppressed(m, 0, 'dead-store')).toBe(true);
    expect(isLintSuppressed(m, 0, 'unused-variable')).toBe(true);
    expect(isLintSuppressed(m, 0, 'empty-if')).toBe(false);
  });

  it('is insensitive to case and whitespace', () => {
    for (const text of [
      'nA = 1; # tm1lint:disable=DEAD-STORE',
      'nA = 1; #  TM1Lint : disable = dead-store ',
      'nA = 1; #tm1lint: disable=dead-store',
    ]) {
      expect(isLintSuppressed(parseLintSuppressions(text), 0, 'dead-store'), text).toBe(true);
    }
  });

  it('is not fooled by a directive inside a string', () => {
    expect(parseLintSuppressions("sT = '# tm1lint: disable=dead-store';").size).toBe(0);
    expect(parseLintSuppressions('602,"# tm1lint: disable"').size).toBe(0);
  });

  it('merges several directives on the same target line', () => {
    const m = parseLintSuppressions([
      '# tm1lint: disable-next-line=dead-store',
      'nA = 1; # tm1lint: disable=unused-variable',
    ].join('\n'));
    expect(isLintSuppressed(m, 1, 'dead-store')).toBe(true);
    expect(isLintSuppressed(m, 1, 'unused-variable')).toBe(true);
  });

  it('`all` beats a list on the same line', () => {
    const m = parseLintSuppressions([
      '# tm1lint: disable-next-line',
      'nA = 1; # tm1lint: disable=unused-variable',
    ].join('\n'));
    expect(isLintSuppressed(m, 1, 'irgendwas')).toBe(true);
  });

  it('points to a line past the end without stumbling', () => {
    const m = parseLintSuppressions('# tm1lint: disable-next-line=dead-store');
    expect(isLintSuppressed(m, 1, 'dead-store')).toBe(true);
    expect(isLintSuppressed(m, 5, 'dead-store')).toBe(false);
  });
});

describe('filterSuppressed', () => {
  const items = [
    { line: 1, ruleId: 'dead-store' },
    { line: 2, ruleId: 'dead-store' },
    { line: 2, ruleId: 'empty-if' },
  ];

  it('returns everything for an empty map', () => {
    expect(filterSuppressed(items, new Map(), i => i.line, i => i.ruleId)).toHaveLength(3);
  });

  it('removes exactly the matched findings', () => {
    const m = parseLintSuppressions('nA = 1;\nnB = 2;\nnC = 3; # tm1lint: disable=dead-store');
    const left = filterSuppressed(items, m, i => i.line, i => i.ruleId);
    expect(left).toEqual([
      { line: 1, ruleId: 'dead-store' },
      { line: 2, ruleId: 'empty-if' },
    ]);
  });

  it('leaves findings without a ruleId alone', () => {
    const m = parseLintSuppressions('# tm1lint: disable-next-line\nnA = 1;');
    const withoutId = [{ line: 1, ruleId: undefined as string | undefined }];
    expect(filterSuppressed(withoutId, m, i => i.line, i => i.ruleId)).toHaveLength(1);
  });
});
