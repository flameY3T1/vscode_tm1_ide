import { describe, it, expect } from 'vitest';
import {
  MDX_KEYWORDS,
  MDX_SET_FUNCTIONS,
  MDX_TUPLE_FUNCTIONS,
  TM1_FUNCTIONS,
  MEMBER_PROPERTIES,
  ALL_FUNCTIONS,
} from '../mdx/mdxFunctions';

describe('mdxFunctions tables', () => {
  it('MDX_KEYWORDS contains core clauses', () => {
    for (const kw of ['SELECT', 'FROM', 'WHERE', 'WITH', 'AS', 'ON', 'NON', 'EMPTY']) {
      expect(MDX_KEYWORDS).toContain(kw);
    }
  });

  it('MDX_SET_FUNCTIONS contains common set ops', () => {
    for (const fn of ['CROSSJOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'FILTER', 'ORDER', 'DESCENDANTS']) {
      expect(MDX_SET_FUNCTIONS.map(f => f.name)).toContain(fn);
    }
  });

  it('TM1_FUNCTIONS contains TM1 extensions', () => {
    const names = TM1_FUNCTIONS.map(f => f.name);
    for (const fn of ['TM1SUBSETALL', 'TM1FILTERBYLEVEL', 'TM1FILTERBYPATTERN']) {
      expect(names).toContain(fn);
    }
  });

  it('MEMBER_PROPERTIES recognises .Members, .Children, .Parent', () => {
    for (const p of ['Members', 'Children', 'Parent', 'CurrentMember', 'Properties']) {
      expect(MEMBER_PROPERTIES).toContain(p);
    }
  });

  it('ALL_FUNCTIONS is the concatenated list', () => {
    expect(ALL_FUNCTIONS.length).toBe(
      MDX_SET_FUNCTIONS.length + MDX_TUPLE_FUNCTIONS.length + TM1_FUNCTIONS.length,
    );
  });

  it('function entries all carry a snippet body', () => {
    for (const f of ALL_FUNCTIONS) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.snippet).toBe('string');
      expect(f.snippet.length).toBeGreaterThan(0);
    }
  });
});
