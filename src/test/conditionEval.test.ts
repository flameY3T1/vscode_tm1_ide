import { describe, it, expect } from 'vitest';
import { evalCondition, shouldPause } from '../debug/conditionEval';

describe('evalCondition', () => {
  it('numeric comparison true/false', () => {
    expect(evalCondition('vN > 5', { vN: '7' })).toEqual({ ok: true, result: true });
    expect(evalCondition('vN > 5', { vN: '3' })).toEqual({ ok: true, result: false });
  });
  it('string equality is case-insensitive via @=', () => {
    expect(evalCondition("sS @= 'abc'", { sS: 'ABC' })).toEqual({ ok: true, result: true });
  });
  it('logical & (and) and % (or)', () => {
    expect(evalCondition('vA > 0 & vB > 0', { vA: '1', vB: '1' })).toEqual({ ok: true, result: true });
    expect(evalCondition('vA > 0 % vB > 0', { vA: '0', vB: '1' })).toEqual({ ok: true, result: true });
  });
  it('unknown referenced variable is an error (fail-safe)', () => {
    const r = evalCondition('vTypo = 1', { vReal: '1' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toMatch(/vTypo/); }
  });
  it('syntax error is an error', () => {
    const r = evalCondition('vN >', { vN: '1' });
    expect(r.ok).toBe(false);
  });
  it('numeric-looking string value is typed numeric', () => {
    expect(evalCondition('vN = 42', { vN: '42' })).toEqual({ ok: true, result: true });
  });
  it('does not flag a function name as an unknown variable', () => {
    // A call node's name must never be reported as an unknown variable —
    // regardless of whether the builtin exists/evaluates. `vN` is the only ident.
    const r = evalCondition("SOMEFUNC(vN) > 0", { vN: '5' });
    if (!r.ok) { expect(r.error).not.toMatch(/Unknown variable: SOMEFUNC/i); }
  });
});

describe('shouldPause', () => {
  it('no condition → always pause', () => {
    expect(shouldPause(undefined, [])).toEqual({ pause: true });
    expect(shouldPause('', [])).toEqual({ pause: true });
  });
  it('condition true → pause', () => {
    expect(shouldPause('vN > 5', [{ name: 'vN', value: '9' }])).toEqual({ pause: true });
  });
  it('condition false → no pause', () => {
    expect(shouldPause('vN > 5', [{ name: 'vN', value: '1' }])).toEqual({ pause: false });
  });
  it('error → pause fail-safe with error text', () => {
    const r = shouldPause('vTypo = 1', [{ name: 'vN', value: '1' }]);
    expect(r.pause).toBe(true);
    expect(r.error).toMatch(/vTypo/);
  });
});
