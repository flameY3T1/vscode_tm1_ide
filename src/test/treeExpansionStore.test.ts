import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeExpansionStore, type Memento } from '../providers/treeExpansionStore';

class FakeMemento implements Memento {
  private _map = new Map<string, unknown>();
  public updateCalls = 0;

  get<T>(key: string): T | undefined {
    return this._map.get(key) as T | undefined;
  }
  update(key: string, value: unknown): Thenable<void> {
    this.updateCalls++;
    this._map.set(key, value);
    return Promise.resolve();
  }
  rawGet(key: string): unknown {
    return this._map.get(key);
  }
  seed(key: string, value: unknown): void {
    this._map.set(key, value);
  }
}

describe('TreeExpansionStore', () => {
  let memento: FakeMemento;
  let store: TreeExpansionStore;

  beforeEach(() => {
    memento = new FakeMemento();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await store?.dispose();
  });

  describe('initial state', () => {
    it('starts empty when memento has no prior data', () => {
      store = new TreeExpansionStore(memento);
      expect(store.size()).toBe(0);
      expect(store.isExpanded('any:id')).toBe(false);
    });

    it('rehydrates from memento on construction', () => {
      memento.seed('tm1.tree.expandedIds', ['s1:cube:Sales', 's1:dim:Time']);
      store = new TreeExpansionStore(memento);
      expect(store.size()).toBe(2);
      expect(store.isExpanded('s1:cube:Sales')).toBe(true);
      expect(store.isExpanded('s1:dim:Time')).toBe(true);
      expect(store.isExpanded('s1:cube:Inventory')).toBe(false);
    });

    it('ignores non-array stored value (corrupt memento)', () => {
      memento.seed('tm1.tree.expandedIds', { not: 'an array' });
      store = new TreeExpansionStore(memento);
      expect(store.size()).toBe(0);
    });
  });

  describe('setExpanded', () => {
    beforeEach(() => { store = new TreeExpansionStore(memento); });

    it('records the id', () => {
      store.setExpanded('s1:cube:Sales');
      expect(store.isExpanded('s1:cube:Sales')).toBe(true);
    });

    it('is idempotent — duplicate add does not trigger extra persist', async () => {
      store.setExpanded('id-1');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      const before = memento.updateCalls;

      store.setExpanded('id-1');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(memento.updateCalls).toBe(before);
    });
  });

  describe('setCollapsed', () => {
    beforeEach(() => { store = new TreeExpansionStore(memento); });

    it('removes a previously expanded id', () => {
      store.setExpanded('id-x');
      store.setCollapsed('id-x');
      expect(store.isExpanded('id-x')).toBe(false);
    });

    it('is no-op when id not present (no persist scheduled)', async () => {
      const before = memento.updateCalls;
      store.setCollapsed('never-added');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(memento.updateCalls).toBe(before);
    });
  });

  describe('debounced persistence', () => {
    beforeEach(() => { store = new TreeExpansionStore(memento); });

    it('does not persist immediately on add', () => {
      store.setExpanded('id-1');
      expect(memento.updateCalls).toBe(0);
    });

    it('persists once after PERSIST_DEBOUNCE_MS elapsed', async () => {
      store.setExpanded('id-1');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(memento.updateCalls).toBe(1);
      expect(memento.rawGet('tm1.tree.expandedIds')).toEqual(['id-1']);
    });

    it('coalesces rapid expand/collapse into single persist', async () => {
      store.setExpanded('id-1');
      vi.advanceTimersByTime(100);
      store.setExpanded('id-2');
      vi.advanceTimersByTime(100);
      store.setCollapsed('id-1');
      vi.advanceTimersByTime(100);
      store.setExpanded('id-3');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(memento.updateCalls).toBe(1);
      expect(memento.rawGet('tm1.tree.expandedIds')).toEqual(['id-2', 'id-3']);
    });
  });

  describe('clearForServer', () => {
    beforeEach(() => { store = new TreeExpansionStore(memento); });

    it('removes the serverRoot node and all child ids of that server', () => {
      store.setExpanded('serverRoot:s1');
      store.setExpanded('s1:cat:Cubes');
      store.setExpanded('s1:cube:Sales');
      const changed = store.clearForServer('s1');
      expect(changed).toBe(true);
      expect(store.isExpanded('serverRoot:s1')).toBe(false);
      expect(store.isExpanded('s1:cat:Cubes')).toBe(false);
      expect(store.isExpanded('s1:cube:Sales')).toBe(false);
      expect(store.size()).toBe(0);
    });

    it('leaves other servers untouched', () => {
      store.setExpanded('serverRoot:s1');
      store.setExpanded('s1:cat:Cubes');
      store.setExpanded('serverRoot:s2');
      store.setExpanded('s2:cat:Dimensions');
      store.clearForServer('s1');
      expect(store.isExpanded('serverRoot:s2')).toBe(true);
      expect(store.isExpanded('s2:cat:Dimensions')).toBe(true);
      expect(store.size()).toBe(2);
    });

    it('does not clear a server whose id is a string-prefix of another', () => {
      store.setExpanded('serverRoot:1');
      store.setExpanded('1:cat:Cubes');
      store.setExpanded('serverRoot:12');
      store.setExpanded('12:cat:Cubes');
      store.clearForServer('1');
      expect(store.isExpanded('serverRoot:12')).toBe(true);
      expect(store.isExpanded('12:cat:Cubes')).toBe(true);
      expect(store.size()).toBe(2);
    });

    it('returns false and schedules no persist when nothing matches', async () => {
      store.setExpanded('s2:cat:Cubes');
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      const before = memento.updateCalls;
      expect(store.clearForServer('s1')).toBe(false);
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
      expect(memento.updateCalls).toBe(before);
    });
  });

  describe('dispose', () => {
    beforeEach(() => { store = new TreeExpansionStore(memento); });

    it('flushes pending writes immediately', async () => {
      store.setExpanded('id-final');
      expect(memento.updateCalls).toBe(0);
      await store.dispose();
      expect(memento.updateCalls).toBe(1);
      expect(memento.rawGet('tm1.tree.expandedIds')).toEqual(['id-final']);
    });

    it('is idempotent', async () => {
      await store.dispose();
      const after = memento.updateCalls;
      await store.dispose();
      expect(memento.updateCalls).toBe(after);
    });

    it('blocks further mutations', async () => {
      await store.dispose();
      store.setExpanded('post-dispose');
      expect(store.isExpanded('post-dispose')).toBe(false);
    });
  });
});
