import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  _connectedConfigs, setDeferredRestore, getConnectedIdsRestored,
} from '../../serverState/state';
import type { Tm1Config } from '../../tm1Rest/transport/types';

// Review 2026-10-07, R1: with the reconnect deferred at activation (only an
// offline `.pro` open), a later command must still find the restored servers
// instead of "No server connected".
describe('getConnectedIdsRestored', () => {
  afterEach(() => { setDeferredRestore(undefined); _connectedConfigs.clear(); });

  it('starts the deferred restore and returns what it connected', async () => {
    const restore = vi.fn(async () => { _connectedConfigs.set('s1', {} as Tm1Config); });
    setDeferredRestore(restore);
    expect(await getConnectedIdsRestored()).toEqual(['s1']);
    expect(await getConnectedIdsRestored()).toEqual(['s1']);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('does not restore while a server is already connected', async () => {
    _connectedConfigs.set('s2', {} as Tm1Config);
    const restore = vi.fn(async () => {});
    setDeferredRestore(restore);
    expect(await getConnectedIdsRestored()).toEqual(['s2']);
    expect(restore).not.toHaveBeenCalled();
  });
});
