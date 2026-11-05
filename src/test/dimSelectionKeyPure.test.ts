import { describe, it, expect } from 'vitest';
import { sameElementSequence } from '../commands/cubeViewer/dimSelectionKeyPure';

describe('sameElementSequence', () => {
  it('same elements, same order → true (no-op)', () => {
    expect(sameElementSequence(['A', 'B', 'C'], ['A', 'B', 'C'])).toBe(true);
  });

  it('same elements, different order → false (reorder is not a no-op)', () => {
    expect(sameElementSequence(['A', 'B', 'C'], ['B', 'A', 'C'])).toBe(false);
  });

  it('changed set (element removed) → false', () => {
    expect(sameElementSequence(['A', 'B', 'C'], ['A', 'B'])).toBe(false);
  });

  it('changed set (element added) → false', () => {
    expect(sameElementSequence(['A', 'B'], ['A', 'B', 'C'])).toBe(false);
  });

  it('duplicates in different positions → false', () => {
    expect(sameElementSequence(['A', 'B', 'A'], ['A', 'A', 'B'])).toBe(false);
  });

  it('duplicates in same positions → true', () => {
    expect(sameElementSequence(['A', 'A', 'B'], ['A', 'A', 'B'])).toBe(true);
  });

  it('both empty → true', () => {
    expect(sameElementSequence([], [])).toBe(true);
  });
});
