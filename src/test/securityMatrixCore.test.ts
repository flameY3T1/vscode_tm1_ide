import { describe, expect, it } from 'vitest';
import {
  initInternalStore,
  toggleGroup,
  setFilter,
  setCellLevel,
  revertAll,
  isDirty,
  visibleRows,
  visibleSelectedGroups,
  computeChanges,
  type MatrixInit,
} from '../webviewClient/_shared/securityMatrixCore';
import type { Group } from '../security/types/group';

type L = 'NONE' | 'READ' | 'WRITE' | 'ADMIN';

const groups: Group[] = [
  { name: 'g1' } as Group,
  { name: 'g2' } as Group,
  { name: 'admins' } as Group,
];

const sampleInit: MatrixInit<L> = {
  rows: ['CubeA', 'CubeB', 'CubeC'],
  groups,
  perms: {
    CubeA: { g1: 'READ', g2: 'NONE', admins: 'ADMIN' },
    CubeB: { g1: 'NONE', g2: 'WRITE', admins: 'ADMIN' },
    CubeC: { g1: 'NONE', g2: 'NONE', admins: 'READ' },
  },
};

describe('securityMatrixCore pure ops', () => {
  describe('initInternalStore', () => {
    it('copies rows + groups + perms (deep)', () => {
      const s = initInternalStore(sampleInit);
      expect(s.rows).toEqual(['CubeA', 'CubeB', 'CubeC']);
      expect(s.groups).toEqual(['g1', 'g2', 'admins']);
      expect(s.original.CubeA.g1).toBe('READ');
      expect(s.current.CubeA.g1).toBe('READ');
    });

    it('original and current are independent', () => {
      const s = initInternalStore(sampleInit);
      s.current.CubeA.g1 = 'ADMIN';
      expect(s.original.CubeA.g1).toBe('READ');
    });

    it('starts with empty selection + filter', () => {
      const s = initInternalStore(sampleInit);
      expect(s.selectedGroups.size).toBe(0);
      expect(s.rowFilter).toBe('');
    });
  });

  describe('toggleGroup', () => {
    it('adds and removes groups', () => {
      let s = initInternalStore(sampleInit);
      s = toggleGroup(s, 'g1');
      expect(s.selectedGroups.has('g1')).toBe(true);
      s = toggleGroup(s, 'g1');
      expect(s.selectedGroups.has('g1')).toBe(false);
    });

    it('does not mutate input', () => {
      const s1 = initInternalStore(sampleInit);
      const s2 = toggleGroup(s1, 'g1');
      expect(s1.selectedGroups.has('g1')).toBe(false);
      expect(s2.selectedGroups.has('g1')).toBe(true);
    });
  });

  describe('setFilter + visibleRows', () => {
    it('returns all rows when filter empty', () => {
      const s = initInternalStore(sampleInit);
      expect(visibleRows(s)).toEqual(['CubeA', 'CubeB', 'CubeC']);
    });

    it('filters case-insensitive substring', () => {
      let s = initInternalStore(sampleInit);
      s = setFilter(s, 'CUBEa');
      expect(visibleRows(s)).toEqual(['CubeA']);
      s = setFilter(s, 'cube');
      expect(visibleRows(s)).toHaveLength(3);
      s = setFilter(s, 'xyz');
      expect(visibleRows(s)).toEqual([]);
    });

    it('trims whitespace', () => {
      let s = initInternalStore(sampleInit);
      s = setFilter(s, '   ');
      expect(visibleRows(s)).toHaveLength(3);
    });
  });

  describe('visibleSelectedGroups', () => {
    it('returns only selected groups in store order', () => {
      let s = initInternalStore(sampleInit);
      s = toggleGroup(s, 'admins');
      s = toggleGroup(s, 'g1');
      expect(visibleSelectedGroups(s)).toEqual(['g1', 'admins']);
    });
  });

  describe('setCellLevel + isDirty', () => {
    it('marks store dirty after change', () => {
      let s = initInternalStore(sampleInit);
      expect(isDirty(s)).toBe(false);
      s = setCellLevel(s, 'CubeA', 'g1', 'ADMIN');
      expect(isDirty(s)).toBe(true);
    });

    it('round-trip change leaves dirty=false', () => {
      let s = initInternalStore(sampleInit);
      s = setCellLevel(s, 'CubeA', 'g1', 'ADMIN');
      s = setCellLevel(s, 'CubeA', 'g1', 'READ');
      expect(isDirty(s)).toBe(false);
    });
  });

  describe('revertAll', () => {
    it('restores current from original', () => {
      let s = initInternalStore(sampleInit);
      s = setCellLevel(s, 'CubeA', 'g1', 'ADMIN');
      s = setCellLevel(s, 'CubeB', 'g2', 'NONE');
      s = revertAll(s);
      expect(isDirty(s)).toBe(false);
      expect(s.current.CubeA.g1).toBe('READ');
      expect(s.current.CubeB.g2).toBe('WRITE');
    });
  });

  describe('computeChanges', () => {
    it('returns empty when clean', () => {
      const s = initInternalStore(sampleInit);
      expect(computeChanges<L>(s)).toEqual([]);
    });

    it('returns all modified cells', () => {
      let s = initInternalStore(sampleInit);
      s = setCellLevel(s, 'CubeA', 'g1', 'ADMIN');
      s = setCellLevel(s, 'CubeC', 'admins', 'WRITE');
      const changes = computeChanges<L>(s);
      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({ row: 'CubeA', group: 'g1', level: 'ADMIN' });
      expect(changes).toContainEqual({ row: 'CubeC', group: 'admins', level: 'WRITE' });
    });

    it('omits cells that were changed then reverted', () => {
      let s = initInternalStore(sampleInit);
      s = setCellLevel(s, 'CubeA', 'g1', 'ADMIN');
      s = setCellLevel(s, 'CubeA', 'g1', 'READ');
      expect(computeChanges<L>(s)).toEqual([]);
    });
  });
});
