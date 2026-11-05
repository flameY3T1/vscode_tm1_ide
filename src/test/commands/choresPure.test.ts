import { describe, it, expect } from 'vitest';
import {
  buildChoreQuickPickItems,
  buildChoreActionItems,
} from '../../commands/chore/choresPure';

describe('buildChoreQuickPickItems', () => {
  it('returns empty array for empty input', () => {
    expect(buildChoreQuickPickItems([])).toEqual([]);
  });

  it('marks active chore with $(check) prefix', () => {
    const items = buildChoreQuickPickItems([{ Name: 'C', Active: true, StartTime: null }]);
    expect(items[0].label).toBe('$(check) C');
    expect(items[0].active).toBe(true);
  });

  it('marks inactive chore with $(circle-outline) prefix', () => {
    const items = buildChoreQuickPickItems([{ Name: 'D', Active: false, StartTime: null }]);
    expect(items[0].label).toBe('$(circle-outline) D');
    expect(items[0].active).toBe(false);
  });

  it('treats missing Active as inactive', () => {
    const items = buildChoreQuickPickItems([{ Name: 'X', StartTime: null }]);
    expect(items[0].label).toBe('$(circle-outline) X');
    expect(items[0].active).toBe(false);
  });

  it('emits startTime when StartTime present', () => {
    const items = buildChoreQuickPickItems([{ Name: 'C', Active: true, StartTime: '2025-01-01T00:00:00' }]);
    expect(items[0].startTime).toBe('2025-01-01T00:00:00');
  });

  it('emits null startTime when StartTime null', () => {
    const items = buildChoreQuickPickItems([{ Name: 'C', Active: true, StartTime: null }]);
    expect(items[0].startTime).toBeNull();
  });

  it('preserves chore reference for callback', () => {
    const c = { Name: 'C', Active: true, StartTime: null, extra: 'data' };
    const items = buildChoreQuickPickItems([c]);
    expect(items[0].chore).toBe(c);
  });

  it('maps multiple chores in order', () => {
    const items = buildChoreQuickPickItems([
      { Name: 'A', Active: true, StartTime: null },
      { Name: 'B', Active: false, StartTime: null },
    ]);
    expect(items.map(i => i.chore.Name)).toEqual(['A', 'B']);
  });
});

describe('buildChoreActionItems', () => {
  it('always includes Execute action first', () => {
    const items = buildChoreActionItems({ Active: false });
    expect(items[0]).toMatchObject({ action: 'execute' });
    expect(items[0].icon).toBe('$(play)');
  });

  it('emits Deactivate action when chore is Active', () => {
    const items = buildChoreActionItems({ Active: true });
    expect(items[1]).toMatchObject({ action: 'deactivate' });
    expect(items[1].icon).toBe('$(debug-stop)');
  });

  it('emits Activate action when chore is Inactive', () => {
    const items = buildChoreActionItems({ Active: false });
    expect(items[1]).toMatchObject({ action: 'activate' });
    expect(items[1].icon).toBe('$(check)');
  });

  it('treats missing Active as Inactive (activate path)', () => {
    const items = buildChoreActionItems({});
    expect(items[1].action).toBe('activate');
  });

  it('returns exactly 2 items', () => {
    expect(buildChoreActionItems({ Active: true })).toHaveLength(2);
    expect(buildChoreActionItems({ Active: false })).toHaveLength(2);
  });
});
