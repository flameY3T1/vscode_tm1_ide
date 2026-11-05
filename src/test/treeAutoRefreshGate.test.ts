/**
 * Codex finding B15: the automatic refresh timer ran unchecked.
 *
 * `tm1.objectExplorerAutoRefreshMs` does clamp to >= 250 ms, but the tick
 * itself knew no condition: it discarded the whole tree, even when the
 * Object Explorer was collapsed in another sidebar or no
 * server was connected at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';
import type { ServerProfile } from '../serverState/state';

const SERVERS = [{ id: 's1', name: 'Srv', serverUrl: 'http://srv' }] as unknown as ServerProfile[];

function makeProvider(connected: boolean) {
  const provider = new Tm1TreeDataProvider(
    () => SERVERS,
    () => connected,
    () => undefined,
  );
  const refresh = vi.spyOn(provider, 'refresh');
  return { provider, refresh };
}

describe('Object Explorer — gate before the automatic refresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refreshes when the view is visible and a server is connected', () => {
    const { provider, refresh } = makeProvider(true);
    provider.setVisibilityProbe(() => true);
    provider.startAutoRefresh(250);
    vi.advanceTimersByTime(1000);
    provider.stopAutoRefresh();
    expect(refresh.mock.calls.length).toBeGreaterThan(0);
  });

  it('stays silent while the view is invisible', () => {
    const { provider, refresh } = makeProvider(true);
    provider.setVisibilityProbe(() => false);
    provider.startAutoRefresh(250);
    vi.advanceTimersByTime(1000);
    provider.stopAutoRefresh();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stays silent without a connected server', () => {
    const { provider, refresh } = makeProvider(false);
    provider.setVisibilityProbe(() => true);
    provider.startAutoRefresh(250);
    vi.advanceTimersByTime(1000);
    provider.stopAutoRefresh();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('0 starts no timer', () => {
    const { provider, refresh } = makeProvider(true);
    provider.setVisibilityProbe(() => true);
    provider.startAutoRefresh(0);
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
