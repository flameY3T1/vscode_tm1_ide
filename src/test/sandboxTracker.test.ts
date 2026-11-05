import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SandboxTracker, type Memento,
  setSandboxTrackerSingleton, setServerIdResolver, withSandbox,
} from '../tm1Rest/sandboxTracker';
import type { Tm1Config } from '../tm1Rest/transport/types';

class FakeMemento implements Memento {
  private _map = new Map<string, unknown>();
  public updateCalls = 0;
  get<T>(key: string): T | undefined { return this._map.get(key) as T | undefined; }
  update(key: string, value: unknown): Thenable<void> {
    this.updateCalls++;
    if (value === undefined) { this._map.delete(key); }
    else { this._map.set(key, value); }
    return Promise.resolve();
  }
  seed(key: string, value: unknown): void { this._map.set(key, value); }
  rawGet(key: string): unknown { return this._map.get(key); }
}

describe('SandboxTracker', () => {
  let memento: FakeMemento;
  let tracker: SandboxTracker;

  beforeEach(() => {
    memento = new FakeMemento();
    tracker = new SandboxTracker(memento);
  });

  describe('getActive', () => {
    it('returns undefined for unknown server', () => {
      expect(tracker.getActive('server-x')).toBeUndefined();
    });

    it('rehydrates from memento', () => {
      memento.seed('tm1.sandbox.active.s1', 'MyBox');
      expect(tracker.getActive('s1')).toBe('MyBox');
    });

    it('treats empty string as undefined', () => {
      memento.seed('tm1.sandbox.active.s1', '');
      expect(tracker.getActive('s1')).toBeUndefined();
    });
  });

  describe('setActive', () => {
    it('persists per-server', async () => {
      await tracker.setActive('s1', 'BoxA');
      await tracker.setActive('s2', 'BoxB');
      expect(memento.rawGet('tm1.sandbox.active.s1')).toBe('BoxA');
      expect(memento.rawGet('tm1.sandbox.active.s2')).toBe('BoxB');
      expect(tracker.getActive('s1')).toBe('BoxA');
      expect(tracker.getActive('s2')).toBe('BoxB');
    });

    it('clears with undefined', async () => {
      await tracker.setActive('s1', 'BoxA');
      await tracker.setActive('s1', undefined);
      expect(tracker.getActive('s1')).toBeUndefined();
      expect(memento.rawGet('tm1.sandbox.active.s1')).toBeUndefined();
    });

    it('clears with empty string (normalized to undefined)', async () => {
      await tracker.setActive('s1', 'BoxA');
      await tracker.setActive('s1', '');
      expect(tracker.getActive('s1')).toBeUndefined();
    });
  });

  describe('onDidChange', () => {
    it('fires on setActive', async () => {
      const listener = vi.fn();
      tracker.onDidChange(listener);
      await tracker.setActive('s1', 'A');
      expect(listener).toHaveBeenCalledWith('s1');
    });

    it('returns unsubscribe', async () => {
      const listener = vi.fn();
      const dispose = tracker.onDidChange(listener);
      dispose();
      await tracker.setActive('s1', 'A');
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', async () => {
      const a = vi.fn();
      const b = vi.fn();
      tracker.onDidChange(a);
      tracker.onDidChange(b);
      await tracker.setActive('s1', 'X');
      expect(a).toHaveBeenCalledWith('s1');
      expect(b).toHaveBeenCalledWith('s1');
    });
  });

  describe('getSandboxHeaders', () => {
    it('returns undefined when no sandbox active', () => {
      expect(tracker.getSandboxHeaders('s1')).toBeUndefined();
    });

    it('returns TM1-Sandbox header when active', async () => {
      await tracker.setActive('s1', 'MyBox');
      expect(tracker.getSandboxHeaders('s1')).toEqual({ 'TM1-Sandbox': 'MyBox' });
    });

    it('isolates per-server', async () => {
      await tracker.setActive('s1', 'A');
      expect(tracker.getSandboxHeaders('s2')).toBeUndefined();
      expect(tracker.getSandboxHeaders('s1')).toEqual({ 'TM1-Sandbox': 'A' });
    });
  });
});

const cfgOf = (serverUrl: string) => ({ serverUrl }) as Tm1Config;

describe('withSandbox singleton helper', () => {
  let memento: FakeMemento;
  let tracker: SandboxTracker;

  beforeEach(() => {
    memento = new FakeMemento();
    tracker = new SandboxTracker(memento);
    setSandboxTrackerSingleton(tracker);
    setServerIdResolver((cfg) => cfg.serverUrl === 'http://prod' ? 's-prod' : cfg.serverUrl === 'http://dev' ? 's-dev' : undefined);
  });

  afterEach(() => {
    setSandboxTrackerSingleton(null);
    setServerIdResolver(null);
  });

  it('returns the existing extras when no singleton wired', async () => {
    setSandboxTrackerSingleton(null);
    expect(withSandbox(cfgOf('http://prod'), { X: '1' })).toEqual({ X: '1' });
  });

  it('returns extras unchanged when the config has no server id', () => {
    expect(withSandbox(cfgOf('http://unknown'), { X: '1' })).toEqual({ X: '1' });
  });

  it('returns extras unchanged when no sandbox active for that server', () => {
    expect(withSandbox(cfgOf('http://prod'), { X: '1' })).toEqual({ X: '1' });
  });

  it('merges sandbox header in front of extras when sandbox active', async () => {
    await tracker.setActive('s-prod', 'Q4Plan');
    expect(withSandbox(cfgOf('http://prod'), { X: '1' })).toEqual({ 'TM1-Sandbox': 'Q4Plan', X: '1' });
  });

  it('returns just sandbox header when extras omitted', async () => {
    await tracker.setActive('s-prod', 'Q4Plan');
    expect(withSandbox(cfgOf('http://prod'))).toEqual({ 'TM1-Sandbox': 'Q4Plan' });
  });

  it('isolates sandboxes per server', async () => {
    await tracker.setActive('s-prod', 'A');
    await tracker.setActive('s-dev', 'B');
    expect(withSandbox(cfgOf('http://prod'))).toEqual({ 'TM1-Sandbox': 'A' });
    expect(withSandbox(cfgOf('http://dev'))).toEqual({ 'TM1-Sandbox': 'B' });
  });

  it('returns undefined when the config is undefined', () => {
    expect(withSandbox(undefined)).toBeUndefined();
  });
});
