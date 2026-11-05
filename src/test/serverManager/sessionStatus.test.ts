// Dot behind the server node (review 2026-09-23, W7): the pure half is tested in
// `tm1Rest/sessionTimeout.test.ts`, here the decoration itself.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

const expires = new Map<string, number | undefined>();
const configs = new Map<string, { serverUrl: string }>();
vi.mock('../../tm1Rest/transport/session', () => ({
  sessionExpiresAt: (cfg: { serverUrl: string }) => expires.get(cfg.serverUrl),
  onSessionOpened: () => ({ dispose() {} }),
}));
vi.mock('../../serverState/state', async () => {
  const { EventEmitter } = await import('../__mocks__/vscode');
  return {
    getConnectedIds: () => [...configs.keys()],
    getServerConfig: (id: string) => configs.get(id),
    onServerChanged: new EventEmitter<void>(),
  };
});

import { registerSessionStatus } from '../../commands/serverManager/sessionStatus';
import { SERVER_STATE_SCHEME } from '../../providers/tm1TreeNodes';

let provider: vscode.FileDecorationProvider;

beforeEach(() => {
  vi.useFakeTimers();
  expires.clear();
  configs.clear();
  vi.mocked(vscode.window.registerFileDecorationProvider).mockClear();
  registerSessionStatus({ subscriptions: [] } as unknown as vscode.ExtensionContext);
  provider = vi.mocked(vscode.window.registerFileDecorationProvider).mock.calls[0][0] as vscode.FileDecorationProvider;
});
afterEach(() => { vi.useRealTimers(); });

const deco = (id: string, scheme = SERVER_STATE_SCHEME) =>
  provider.provideFileDecoration(
    { scheme, path: '/' + encodeURIComponent(id) } as vscode.Uri, {} as vscode.CancellationToken,
  ) as vscode.FileDecoration | undefined;

describe('session status decoration', () => {
  it('hover text only — the dot lives in the server icon now', () => {
    configs.set('Prod A', { serverUrl: 'http://a:1' });
    expires.set('http://a:1', Date.now() + 60_000);
    expect(deco('Prod A')?.badge).toBeUndefined();
    expect(deco('Prod A')?.tooltip).toBe('Session active');
    expires.set('http://a:1', Date.now() - 1);
    expect(deco('Prod A')?.tooltip).toMatch(/expired/);
  });

  it('no dot for a disconnected server or a foreign scheme', () => {
    expect(deco('gone')).toBeUndefined();
    configs.set('x', { serverUrl: 'http://x:1' });
    expires.set('http://x:1', Date.now() + 60_000);
    expect(deco('x', 'file')).toBeUndefined();
  });

  it('no colour on the decoration — it would tint the node name too', () => {
    configs.set('x', { serverUrl: 'http://x:1' });
    expires.set('http://x:1', Date.now() + 60_000);
    expect(deco('x')?.color).toBeUndefined();
  });
});
