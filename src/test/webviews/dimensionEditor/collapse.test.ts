import { describe, it, expect } from 'vitest';
import { directChildConsolidations } from '../../../webviewClient/dimensionEditor/collapse';

describe('directChildConsolidations', () => {
  // Tree: Total -> {Europe -> {DE, FR}, Asia -> {JP}}, plus leaf Cash under Total.
  const edges = [
    { parent: 'Total', child: 'Europe' },
    { parent: 'Total', child: 'Asia' },
    { parent: 'Total', child: 'Cash' },
    { parent: 'Europe', child: 'DE' },
    { parent: 'Europe', child: 'FR' },
    { parent: 'Asia', child: 'JP' },
  ];

  it('returns only direct children that are themselves parents', () => {
    // Europe + Asia have children; Cash is a leaf and excluded.
    expect(directChildConsolidations(edges, 'Total')).toEqual(['Europe', 'Asia']);
  });

  it('returns empty for a node whose direct children are all leaves', () => {
    expect(directChildConsolidations(edges, 'Europe')).toEqual([]);
  });

  it('returns empty for an unknown parent', () => {
    expect(directChildConsolidations(edges, 'Nope')).toEqual([]);
  });

  it('ignores deleted edges when deciding parentage', () => {
    const withDeleted = [
      { parent: 'Total', child: 'Europe' },
      // Europe's only child is deleted -> Europe no longer a consolidation.
      { parent: 'Europe', child: 'DE', marked: 'deleted' },
    ];
    expect(directChildConsolidations(withDeleted, 'Total')).toEqual([]);
  });

  it('skips a direct child reached only via a deleted edge', () => {
    const withDeleted = [
      { parent: 'Total', child: 'Europe', marked: 'deleted' },
      { parent: 'Europe', child: 'DE' },
    ];
    expect(directChildConsolidations(withDeleted, 'Total')).toEqual([]);
  });

  it('does not duplicate a child that appears under the parent twice', () => {
    const dup = [
      { parent: 'Total', child: 'Europe' },
      { parent: 'Total', child: 'Europe' },
      { parent: 'Europe', child: 'DE' },
    ];
    expect(directChildConsolidations(dup, 'Total')).toEqual(['Europe']);
  });
});
