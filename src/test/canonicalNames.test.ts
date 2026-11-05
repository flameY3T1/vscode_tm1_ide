import { describe, it, expect } from 'vitest';
import { buildCanonicalNames } from '../tiLogicVisualizer/tiLinter/helpers/canonicalNames';

const empty = { prolog: '', metadata: '', data: '', epilog: '' };

describe('buildCanonicalNames', () => {
  it('uses first assignment spelling process-wide', () => {
    const m = buildCanonicalNames(
      { ...empty, prolog: 'vCount = 1;', data: 'vcount = vcount + 1;', epilog: 'VCOUNT = 0;' },
      [], [],
    );
    expect(m.get('vcount')).toBe('vCount');
  });
  it('parameter spelling wins over later assignment', () => {
    const m = buildCanonicalNames({ ...empty, prolog: 'pUSER = 1;' }, ['pUser'], []);
    expect(m.get('puser')).toBe('pUser');
  });
  it('datasource var spelling wins over assignment', () => {
    const m = buildCanonicalNames({ ...empty, data: 'vsrc = 1;' }, [], ['vSrc']);
    expect(m.get('vsrc')).toBe('vSrc');
  });
  it('falls back to first occurrence for read-only identifiers', () => {
    const m = buildCanonicalNames({ ...empty, prolog: "If(vFlag = 1);", data: 'x = vflag;' }, [], []);
    expect(m.get('vflag')).toBe('vFlag');
  });
  it('excludes function names, keywords, and string contents', () => {
    const m = buildCanonicalNames({ ...empty, prolog: "vX = CellGetN('Cube');" }, [], []);
    expect(m.has('cellgetn')).toBe(false);
    expect(m.has('cube')).toBe(false);
    expect(m.get('vx')).toBe('vX');
  });

  it('does not treat == comparison LHS as an assignment target', () => {
    // First real assignment is in data; prolog only compares. Canonical = first assignment spelling.
    const m = buildCanonicalNames(
      { ...empty, prolog: 'If(VFLAG == 1);', data: 'vFlag = 1;' }, [], [],
    );
    expect(m.get('vflag')).toBe('vFlag');
  });

  it('parameter spelling beats datasource var for the same name', () => {
    const m = buildCanonicalNames({ ...empty }, ['pKey'], ['PKEY']);
    expect(m.get('pkey')).toBe('pKey');
  });

  it('excludes control-flow keywords', () => {
    const m = buildCanonicalNames({ ...empty, prolog: 'If(vX = 1);\nEndIf;' }, [], []);
    expect(m.has('if')).toBe(false);
    expect(m.has('endif')).toBe(false);
  });
});
