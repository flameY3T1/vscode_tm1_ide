import { describe, it, expect } from 'vitest';
import {
  recommendOrder,
  buildReorderBody,
  classifyReorderError,
} from '../../tm1Rest/reorderDimsPure';

describe('recommendOrder', () => {
  it('sorts movable dims by leafCount ascending, pins last dim last', () => {
    const order = recommendOrder(
      [
        { name: 'A', leafCount: 30 },
        { name: 'B', leafCount: 10 },
        { name: 'C', leafCount: 20 },
      ],
      ['A', 'B', 'C'],
    );
    expect(order).toEqual(['B', 'A', 'C']); // C is original-last → pinned; B(10) < A(30)
  });

  it('keeps null-count dims in their original slot', () => {
    const order = recommendOrder(
      [
        { name: 'A', leafCount: 30 },
        { name: 'B', leafCount: null },
        { name: 'C', leafCount: 20 },
        { name: 'D', leafCount: 5 },
      ],
      ['A', 'B', 'C', 'D'],
    );
    // D last (pinned), B null (slot 1 pinned); movable C(20),A(30) → slots 0,2
    expect(order).toEqual(['C', 'B', 'A', 'D']);
  });

  it('is stable on ties (keeps original relative order)', () => {
    const order = recommendOrder(
      [
        { name: 'A', leafCount: 10 },
        { name: 'B', leafCount: 10 },
        { name: 'C', leafCount: 99 },
      ],
      ['A', 'B', 'C'],
    );
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

describe('buildReorderBody', () => {
  it('builds Dimensions@odata.bind in order', () => {
    expect(JSON.parse(buildReorderBody(['D1', 'D2']))).toEqual({
      'Dimensions@odata.bind': ["Dimensions('D1')", "Dimensions('D2')"],
    });
  });
  it('escapes single quotes in names', () => {
    expect(JSON.parse(buildReorderBody(["O'Brien"]))).toEqual({
      'Dimensions@odata.bind': ["Dimensions('O''Brien')"],
    });
  });
  it('URL-encodes reserved chars (bind = resource path, not literal)', () => {
    expect(JSON.parse(buildReorderBody(["A/B#C?D'E F"]))).toEqual({
      'Dimensions@odata.bind': ["Dimensions('A%2FB%23C%3FD''E%20F')"],
    });
  });
});

describe('classifyReorderError', () => {
  it('404/501 → versionGate', () => {
    expect(classifyReorderError(404, 'x')).toBe('versionGate');
    expect(classifyReorderError(501, 'x')).toBe('versionGate');
  });
  it('re-ordering failed → typeConstraint', () => {
    expect(classifyReorderError(500, 'Dimension re-ordering failed')).toBe('typeConstraint');
  });
  it('otherwise generic', () => {
    expect(classifyReorderError(403, 'no admin')).toBe('generic');
  });
});
