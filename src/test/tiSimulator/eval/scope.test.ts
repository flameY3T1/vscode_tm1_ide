import { describe, it, expect } from 'vitest';
import { Scope } from '../../../tiSimulator/eval/scope';

describe('Scope', () => {
  it('stores + retrieves values', () => {
    const s = new Scope();
    s.set('x', 42);
    expect(s.get('x')).toBe(42);
  });

  it('returns undefined for unknown', () => {
    expect(new Scope().get('nope')).toBeUndefined();
  });

  it('child writes through to existing parent binding (flat TI semantics)', () => {
    // TI processes have flat process-scoped variables — child scopes used for
    // per-row data binding must not shadow process-level assignments. Writing
    // through to the parent keeps counters like `nDataCount = nDataCount + 1`
    // working across data-row iterations.
    const root = new Scope();
    root.set('x', 1);
    const child = root.child();
    child.set('x', 2);
    expect(root.get('x')).toBe(2);
    expect(child.get('x')).toBe(2);
  });

  it('child set creates binding when name is fresh', () => {
    const root = new Scope();
    const child = root.child();
    child.set('rowVar', 'a');
    expect(child.get('rowVar')).toBe('a');
    expect(root.get('rowVar')).toBeUndefined();
  });

  it('child reads parent when own does not have', () => {
    const root = new Scope();
    root.set('y', 'hello');
    const child = root.child();
    expect(child.get('y')).toBe('hello');
  });

  it('has() walks parent chain', () => {
    const root = new Scope();
    root.set('a', 1);
    expect(root.child().has('a')).toBe(true);
    expect(root.child().has('b')).toBe(false);
  });
});
