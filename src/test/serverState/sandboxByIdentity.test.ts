import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { _connectedConfigs, getServerIdByConfig } from '../../serverState/state';
import {
  SandboxTracker, setSandboxTrackerSingleton, setServerIdResolver, withSandbox,
} from '../../tm1Rest/sandboxTracker';
import type { Tm1Config } from '../../tm1Rest/transport/types';

// Two profiles on one URL (other user, other v12 database): the sandbox the
// user picked for A must not ride along on B's requests, and vice versa. The
// old URL resolver returned the first connected profile with that URL.
const URL = 'https://tm1:8016';
const A = { serverUrl: URL, username: 'alice', password: 'a', authType: 'Basic', rejectUnauthorized: false } as Tm1Config;
const B = { serverUrl: URL, username: 'bob', password: 'b', authType: 'Basic', rejectUnauthorized: false } as Tm1Config;

const raw = new Map<string, unknown>();
const memento = { get: <T,>(k: string) => raw.get(k) as T | undefined, update: async (k: string, v: unknown) => { raw.set(k, v); } };

describe('sandbox header follows the profile, not the URL', () => {
  let tracker: SandboxTracker;
  beforeEach(() => {
    raw.clear();
    tracker = new SandboxTracker(memento);
    setSandboxTrackerSingleton(tracker);
    setServerIdResolver((cfg) => getServerIdByConfig(cfg));
    _connectedConfigs.set('id-a', A);
    _connectedConfigs.set('id-b', B);
  });
  afterEach(() => { setSandboxTrackerSingleton(null); setServerIdResolver(null); _connectedConfigs.clear(); });

  it("B's request carries no sandbox when only A picked one", async () => {
    await tracker.setActive('id-a', 'PlanA');
    expect(withSandbox(A)).toEqual({ 'TM1-Sandbox': 'PlanA' });
    expect(withSandbox(B)).toBeUndefined();
  });

  it("B's own sandbox reaches B's request", async () => {
    await tracker.setActive('id-b', 'PlanB');
    expect(withSandbox(B)).toEqual({ 'TM1-Sandbox': 'PlanB' });
  });

  it('an impersonated config still belongs to its profile', async () => {
    await tracker.setActive('id-b', 'PlanB');
    expect(withSandbox({ ...B, impersonate: 'carol' })).toEqual({ 'TM1-Sandbox': 'PlanB' });
  });

  it('falls back to the URL only when one profile carries it', () => {
    _connectedConfigs.delete('id-b');
    expect(getServerIdByConfig({ ...A, password: 'changed' })).toBe('id-a');
    _connectedConfigs.set('id-b', B);
    expect(getServerIdByConfig({ ...A, password: 'changed' })).toBeUndefined();
  });
});
