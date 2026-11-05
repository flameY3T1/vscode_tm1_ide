import { describe, it, expect } from 'vitest';
import { parseHitSpec, hitCountSatisfied } from '../debug/conditionEval';

describe('parseHitSpec', () => {
  it('parses operators and bare number', () => {
    expect(parseHitSpec('>=5')).toEqual({ kind: 'spec', op: '>=', n: 5 });
    expect(parseHitSpec('=3')).toEqual({ kind: 'spec', op: '=', n: 3 });
    expect(parseHitSpec('%10')).toEqual({ kind: 'spec', op: '%', n: 10 });
    expect(parseHitSpec('7')).toEqual({ kind: 'spec', op: '>=', n: 7 });
    expect(parseHitSpec('  >= 5 ')).toEqual({ kind: 'spec', op: '>=', n: 5 });
  });
  it('treats empty as none', () => {
    expect(parseHitSpec('')).toEqual({ kind: 'none' });
    expect(parseHitSpec('   ')).toEqual({ kind: 'none' });
  });
  it('rejects garbage and non-positive N', () => {
    expect(parseHitSpec('abc')).toEqual({ kind: 'invalid' });
    expect(parseHitSpec('>=0')).toEqual({ kind: 'invalid' });
    expect(parseHitSpec('%0')).toEqual({ kind: 'invalid' });
    expect(parseHitSpec('=0')).toEqual({ kind: 'invalid' });
    expect(parseHitSpec('>5')).toEqual({ kind: 'invalid' });
  });
});

describe('hitCountSatisfied', () => {
  it('none → always pass', () => {
    expect(hitCountSatisfied('', 1)).toEqual({ pass: true });
  });
  it('= matches only exact hit', () => {
    expect(hitCountSatisfied('=3', 2).pass).toBe(false);
    expect(hitCountSatisfied('=3', 3).pass).toBe(true);
    expect(hitCountSatisfied('=3', 4).pass).toBe(false);
  });
  it('>= matches from N onward', () => {
    expect(hitCountSatisfied('>=3', 2).pass).toBe(false);
    expect(hitCountSatisfied('>=3', 3).pass).toBe(true);
    expect(hitCountSatisfied('>=3', 9).pass).toBe(true);
  });
  it('% matches every Nth', () => {
    expect(hitCountSatisfied('%3', 3).pass).toBe(true);
    expect(hitCountSatisfied('%3', 6).pass).toBe(true);
    expect(hitCountSatisfied('%3', 4).pass).toBe(false);
  });
  it('invalid → fail-safe pass with error', () => {
    const r = hitCountSatisfied('abc', 1);
    expect(r.pass).toBe(true);
    expect(r.error).toBeTruthy();
  });
});
