import { describe, it, expect } from 'vitest';
import { getTiHierarchyContext, getTiContextEndpoint } from '../providers/tiContextPatternsPure';

describe('getTiHierarchyContext', () => {
  it('recognizes the hierarchy argument and returns the dimension before it', () => {
    expect(getTiHierarchyContext("HierarchyExists('Product', '")).toEqual({ dimension: 'Product' });
    expect(getTiHierarchyContext("HierarchyElementInsert('Product','Ma")).toEqual({ dimension: 'Product' });
  });

  it('stays silent in the dimension argument — the dimension endpoint applies there', () => {
    expect(getTiHierarchyContext("HierarchyExists('Pro")).toBeNull();
    expect(getTiContextEndpoint("HierarchyExists('Pro")).toBe('Dimensions');
  });

  it('stays silent when the dimension is a variable', () => {
    // No hierarchy can be fetched from a variable at typing time,
    // and the list of a FOREIGN dimension would be worse than none.
    expect(getTiHierarchyContext("HierarchyExists(pDim, '")).toBeNull();
  });

  it('is not fooled by parentheses and commas inside strings', () => {
    expect(getTiHierarchyContext("HierarchyExists('A(x),y', '")).toEqual({ dimension: 'A(x),y' });
  });

  it('finds the enclosing call even behind a nested one', () => {
    expect(getTiHierarchyContext("HierarchyExists( ATTRS('D','E','A'), '")).toBeNull();
    expect(getTiHierarchyContext("If(HierarchyExists('Product', '")).toEqual({ dimension: 'Product' });
  });

  it('stays silent outside an open string', () => {
    expect(getTiHierarchyContext("HierarchyExists('Product', ")).toBeNull();
  });
});
