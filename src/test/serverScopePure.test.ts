import { describe, it, expect } from 'vitest';
import { matchesServerScope } from '../utils/serverScopePure';

describe('matchesServerScope', () => {
  it('visible everywhere without a restriction', () => {
    expect(matchesServerScope(undefined, 'Prod')).toBe(true);
    expect(matchesServerScope('', 'Prod')).toBe(true);
    expect(matchesServerScope('   ', undefined)).toBe(true);
  });

  it('NOT visible with a restriction and without a connection', () => {
    // Without a connected server there is no way to check whether the entry matches.
    expect(matchesServerScope('Prod', undefined)).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(matchesServerScope('Prod', 'prod')).toBe(true);
    expect(matchesServerScope('PROD;Test', 'test')).toBe(true);
  });

  it('tolerates whitespace and empty list members', () => {
    expect(matchesServerScope(' Prod ; ; Test ', 'Test')).toBe(true);
  });

  it('a list made only of separators is visible NOWHERE', () => {
    // `';;;'` is not empty, so the restriction applies — but the allow list
    // is empty afterwards. This is the behavior of both predecessor copies, only
    // recorded here: the extraction must not shift it.
    expect(matchesServerScope(';;;', 'Test')).toBe(false);
  });

  it('excludes other servers', () => {
    expect(matchesServerScope('Prod;Test', 'Dev')).toBe(false);
    // No substring match: "Pro" is not "Prod".
    expect(matchesServerScope('Prod', 'Pro')).toBe(false);
  });
});
