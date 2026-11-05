import { describe, it, expect } from 'vitest';
import {
  formatRulesText, mergeRuleFormatConfig, DEFAULT_RULE_FORMAT_CONFIG,
} from '../tiLogicVisualizer/formatRulesText';

describe('formatRulesText', () => {
  it('spaces operators outside brackets, leaves element refs untouched', () => {
    expect(formatRulesText(`['Sales']=N:['Price']*['Qty'];`))
      .toBe(`['Sales'] = N: ['Price'] * ['Qty'];`);
  });

  it('spaces structural commas inside element-ref tuples (names stay quoted)', () => {
    expect(formatRulesText(`['Actual','Jan']=N:DB('Cube',!region,'val');`))
      .toBe(`['Actual', 'Jan'] = N: DB('Cube', !region, 'val');`);
  });

  it('spaces commas inside {set} braces too', () => {
    expect(formatRulesText(`['Datenarten':{'Vorschau','Plan'}]=N:1;`))
      .toBe(`['Datenarten':{'Vorschau', 'Plan'}] = N: 1;`);
  });

  it('does not touch a comma inside a quoted element name', () => {
    expect(formatRulesText(`['a,b']=N:1;`)).toBe(`['a,b'] = N: 1;`);
  });

  it('feeder operator => stays atomic and gets one space each side', () => {
    expect(formatRulesText(`['a']=>['b'];`)).toBe(`['a'] => ['b'];`);
  });

  it('uppercases rule-type qualifier n:/s:/c:', () => {
    expect(formatRulesText(`['x']=n:1;\n['y']=s:'a';\n['z']=c:2;`))
      .toBe(`['x'] = N: 1;\n['y'] = S: 'a';\n['z'] = C: 2;`);
  });

  it('uppercases SKIPCHECK/FEEDERS keywords', () => {
    expect(formatRulesText(`skipcheck;\nfeeders;`)).toBe(`SKIPCHECK;\nFEEDERS;`);
  });

  it('canonicalizes known function casing', () => {
    expect(formatRulesText(`['x']=N:db('C',!d);`)).toBe(`['x'] = N: DB('C', !d);`);
  });

  it('does not touch text inside strings', () => {
    expect(formatRulesText(`['x']=S:'a=b*c';`)).toBe(`['x'] = S: 'a=b*c';`);
  });

  it('does not touch comments', () => {
    expect(formatRulesText(`['x']=N:1; #a=b*c`)).toBe(`['x'] = N: 1; # a=b*c`);
  });

  it('splits multiple statements onto separate lines', () => {
    expect(formatRulesText(`['a']=>['b']; ['c']=>['d'];`))
      .toBe(`['a'] => ['b'];\n['c'] => ['d'];`);
  });

  it('collapses 3+ blank lines to 2', () => {
    expect(formatRulesText(`SKIPCHECK;\n\n\n\nFEEDERS;`)).toBe(`SKIPCHECK;\n\n\nFEEDERS;`);
  });

  it('strips trailing whitespace', () => {
    expect(formatRulesText(`SKIPCHECK;   `)).toBe(`SKIPCHECK;`);
  });

  it('preserves leading indentation of a line', () => {
    expect(formatRulesText(`    ['x'] = N: 1;`)).toBe(`    ['x'] = N: 1;`);
  });

  it('is idempotent', () => {
    const src = `['Sales']=N:['Price']*['Qty'];\n['a']=>['b'];`;
    const once = formatRulesText(src);
    expect(formatRulesText(once)).toBe(once);
  });

  it('skips operator spacing when disabled', () => {
    const cfg = { ...DEFAULT_RULE_FORMAT_CONFIG, enabled: { ...DEFAULT_RULE_FORMAT_CONFIG.enabled, operators: false, casing: false } };
    expect(formatRulesText(`['x']=N:['a']*['b'];`, cfg)).toBe(`['x']=N:['a']*['b'];`);
  });

  it('skips casing when disabled', () => {
    const cfg = { ...DEFAULT_RULE_FORMAT_CONFIG, enabled: { ...DEFAULT_RULE_FORMAT_CONFIG.enabled, casing: false } };
    expect(formatRulesText(`skipcheck;`, cfg)).toBe(`skipcheck;`);
  });

  it('skips statement splitting when disabled', () => {
    const cfg = { ...DEFAULT_RULE_FORMAT_CONFIG, enabled: { ...DEFAULT_RULE_FORMAT_CONFIG.enabled, splitStatements: false } };
    expect(formatRulesText(`['a']=>['b']; ['c']=>['d'];`, cfg)).toBe(`['a'] => ['b']; ['c'] => ['d'];`);
  });
});

describe('mergeRuleFormatConfig', () => {
  it('returns defaults for undefined', () => {
    expect(mergeRuleFormatConfig(undefined)).toEqual(DEFAULT_RULE_FORMAT_CONFIG);
  });

  it('backfills missing rule flags from defaults', () => {
    const merged = mergeRuleFormatConfig({ enabled: { operators: false } as never });
    expect(merged.enabled.operators).toBe(false);
    expect(merged.enabled.casing).toBe(true);
    expect(merged.parenStyle).toBe('tight');
  });
});
