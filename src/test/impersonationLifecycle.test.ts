// Two flows that both only go wrong after an `await` and therefore stay
// invisible when reading the source: the late switch that reinstates a
// disconnected connection, and the kept own session that nobody closes any
// more on disconnect.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const closeSession = vi.fn<(cfg: unknown) => Promise<void>>(async () => {});
const apiRequest = vi.fn(async () => ({ statusCode: 200, body: '' }));
vi.mock('../tm1Client', () => ({
  apiRequest: () => apiRequest(),
  closeSession: (cfg: unknown) => closeSession(cfg),
  setConfigOverride: vi.fn(),
}));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../serverState/serverDisposeRegistry', () => ({ disposeAllForServer: vi.fn() }));

import type { Tm1Config } from '../tm1Rest/transport/types';
import { _connectedConfigs } from '../serverState/state';
import {
  setImpersonation,
  forgetImpersonation,
  _clearImpersonationsForTest,
} from '../commands/serverManager/impersonation';

const admin: Tm1Config = {
  serverUrl: 'https://h:8010', username: 'admin', password: 'pw',
  rejectUnauthorized: true, authType: 'Basic',
};

// `setImpersonation` only reads `globalState.get` — the mock needs nothing more.
const ctx = { globalState: { get: () => undefined } } as never;

beforeEach(() => {
  _connectedConfigs.clear();
  _clearImpersonationsForTest();
  closeSession.mockReset();
  closeSession.mockResolvedValue(undefined);
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ statusCode: 200, body: '' });
});

describe('Impersonation — lifecycle', () => {
  it('a late switch does NOT reinstate a disconnected connection', async () => {
    _connectedConfigs.set('srv1', { ...admin, impersonate: 'reader' });

    let freigeben!: () => void;
    closeSession.mockImplementation(() => new Promise<void>(r => { freigeben = r; }));

    const beenden = setImpersonation(ctx, 'srv1', undefined);
    // While `closeSession` hangs: disconnect.
    _connectedConfigs.delete('srv1');
    freigeben();
    await beenden;

    expect(_connectedConfigs.has('srv1')).toBe(false);
  });

  it('ending restores the own configuration when nothing intervened', async () => {
    _connectedConfigs.set('srv1', admin);
    await setImpersonation(ctx, 'srv1', 'reader');
    expect(_connectedConfigs.get('srv1')?.impersonate).toBe('reader');

    await setImpersonation(ctx, 'srv1', undefined);
    expect(_connectedConfigs.get('srv1')?.impersonate).toBeUndefined();
  });

  it('disconnecting during impersonation also closes the kept own session', async () => {
    _connectedConfigs.set('srv1', admin);
    await setImpersonation(ctx, 'srv1', 'reader');
    closeSession.mockClear();

    // What the disconnect does: first close the configuration from
    // `_connectedConfigs` (the impersonated one), then forget the mapping.
    forgetImpersonation('srv1');
    await Promise.resolve();

    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(closeSession.mock.calls[0][0]).toMatchObject({ username: 'admin' });
    expect((closeSession.mock.calls[0][0] as Tm1Config).impersonate).toBeUndefined();
  });

  it('TM1 refuses an ADMIN member (403): the own view stays, no switch', async () => {
    _connectedConfigs.set('srv1', admin);
    apiRequest.mockResolvedValue({ statusCode: 403, body: 'insufficient rights to impersonate' });
    await expect(setImpersonation(ctx, 'srv1', 'OtherAdmin')).rejects.toThrow(/ADMIN/);
    expect(_connectedConfigs.get('srv1')).toBe(admin);
  });
});
