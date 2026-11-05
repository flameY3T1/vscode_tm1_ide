// src/test/serverConfig/configClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from '../../serverConfig/configClassifier';

describe('classify', () => {
  it('returns schema-derived metadata for known params', () => {
    expect(classify('HTTPPortNumber')).toEqual({
      cluster: 'connection',
      isStatic: true,
      requiresRestart: true,
      readonly: false,
      known: true,
    });
  });

  it('classifies unknown params as misc, non-static, mutable, unknown', () => {
    expect(classify('SomeNewFutureParam')).toEqual({
      cluster: 'misc',
      isStatic: false,
      requiresRestart: false,
      readonly: false,
      known: false,
    });
  });

  it('marks readonly params correctly', () => {
    const c = classify('ProductVersion');
    expect(c.readonly).toBe(true);
    expect(c.known).toBe(true);
  });
});
