// Target selection for "deploy to another server" (review 2026-09-23, W7).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const servers = new Map<string, { serverUrl: string }>();
const names = new Map<string, string>();
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../../../serverState/state', async () => await import('../../../commands/serverManager'));
vi.mock('../../../commands/serverManager', () => ({
  getConnectedIds: () => [...servers.keys()],
  getServerConfig: (id: string) => servers.get(id),
  getServerNameByUrl: (url: string) => names.get(url),
}));

import { pickServerLabel, pickTargetServer } from '../../../commands/deploy/pickTarget';

beforeEach(() => {
  servers.clear();
  names.clear();
  vi.mocked(vscode.window.showQuickPick).mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockReset();
});

describe('pickServerLabel', () => {
  it('prefers the profile name, then host:port, then the raw URL', () => {
    names.set('http://a:1', 'Prod');
    expect(pickServerLabel('http://a:1')).toBe('Prod');
    expect(pickServerLabel('https://b:5895/api')).toBe('b:5895');
    expect(pickServerLabel('https://c/api')).toBe('c');
    expect(pickServerLabel('kein url')).toBe('kein url');
    expect(pickServerLabel(undefined, 'id7')).toBe('id7');
  });
});

describe('pickTargetServer', () => {
  it('says so and returns nothing when only the source is connected', async () => {
    servers.set('src', { serverUrl: 'http://src:1' });
    expect(await pickTargetServer('src', 'Deploy')).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('offers every connected server except the source and returns the pick', async () => {
    servers.set('src', { serverUrl: 'http://src:1' });
    servers.set('t1', { serverUrl: 'http://t1:1' });
    servers.set('t2', { serverUrl: 'http://t2:2' });
    names.set('http://t2:2', 'Test');
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (items as vscode.QuickPickItem[])[1]);

    const picked = await pickTargetServer('src', 'Deploy');
    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as Array<{ id: string; label: string }>;
    expect(offered.map(i => i.id)).toEqual(['t1', 't2']);
    expect(picked).toEqual({ id: 't2', label: 'Test', cfg: { serverUrl: 'http://t2:2' } });
  });

  it('returns nothing on cancel, and reports a vanished config', async () => {
    servers.set('src', { serverUrl: 'http://src:1' });
    servers.set('t1', { serverUrl: 'http://t1:1' });
    expect(await pickTargetServer('src', 'Deploy')).toBeUndefined();

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      servers.delete('t1'); // disconnected between list and selection
      return (items as vscode.QuickPickItem[])[0];
    });
    expect(await pickTargetServer('src', 'Deploy')).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });
});
