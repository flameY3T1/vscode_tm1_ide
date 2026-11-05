import { describe, it, expect } from 'vitest';
import { getNonce } from '../../utils/nonce';

describe('getNonce', () => {
  it('returns 32-char hex string', () => {
    const n = getNonce();
    expect(n).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces unique values across calls (CSPRNG uniqueness sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(getNonce());
    expect(seen.size).toBe(1000);
  });
});
