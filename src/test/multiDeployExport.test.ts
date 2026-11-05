import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn((res: any) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`HTTP ${res.statusCode}`);
    }
  }),
}));
vi.mock('../tm1Rest/processApi', async () => {
  const actual = await vi.importActual<typeof import('../tm1Rest/processApi')>('../tm1Rest/processApi');
  return { ...actual, deployProcess: vi.fn().mockResolvedValue(undefined) };
});
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../serverState/state', async () => await import('../commands/serverManager'));
vi.mock('../commands/serverManager', () => ({
  getServerConfig: vi.fn(),
  getConnectedIds: vi.fn(),
  getServerNameByUrl: vi.fn(() => undefined),
  formatServerLabel: vi.fn((url?: string) => url ?? ''),
}));
vi.mock('../commands/processEditor/deploy', () => ({
  pickDeployTarget: vi.fn(),
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: vi.fn() };
});

import * as fs from 'fs';
import { apiRequest } from '../tm1Rest/client';
import { deployProcess } from '../tm1Rest/processApi';
import { getServerConfig, getConnectedIds } from '../commands/serverManager';
import { deployMultipleProcessesToServerCommand } from '../commands/processEditor/deployToServer';
import { exportSelectedProcessesCommand } from '../commands/processEditor/loadProcesses';

const win = vscode.window as any;
const cmds = vscode.commands as any;

function node(name: string, serverId: string, nodeType = 'process'): any {
  return { nodeType, meta: { processName: name, serverId } };
}

const FAKE_CFG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'basic' } as any;

const FAKE_PROCESS = {
  Name: 'P1',
  PrologProcedure: '# prolog',
  MetadataProcedure: '',
  DataProcedure: '',
  EpilogProcedure: '',
  DataSource: { Type: 'None' },
  Parameters: [],
  Variables: [],
  UIData: 'CubeAction=1511DataAction=1503CubeLogChanges=0',
};

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(deployProcess).mockReset().mockResolvedValue(undefined);
  vi.mocked(getServerConfig).mockReset();
  vi.mocked(getConnectedIds).mockReset();
  vi.mocked(fs.writeFileSync).mockReset();
  win.showErrorMessage = vi.fn().mockResolvedValue(undefined);
  win.showInformationMessage = vi.fn().mockResolvedValue(undefined);
  win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
  win.showQuickPick = vi.fn();
  win.showOpenDialog = vi.fn();
  cmds.executeCommand = vi.fn().mockResolvedValue(undefined);
});

describe('deployMultipleProcessesToServerCommand', () => {
  it('errors when no process nodes selected', async () => {
    await deployMultipleProcessesToServerCommand(undefined, []);
    expect(win.showErrorMessage).toHaveBeenCalledWith('No processes selected.');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('errors when selection spans multiple source servers', async () => {
    await deployMultipleProcessesToServerCommand(undefined, [node('P1', 'srvA'), node('P2', 'srvB')]);
    expect(win.showErrorMessage).toHaveBeenCalledWith(
      'All selected processes must come from the same source server.',
    );
  });

  it('filters non-process nodes', async () => {
    await deployMultipleProcessesToServerCommand(undefined, [
      { nodeType: 'cube', meta: { cubeName: 'C', serverId: 'a' } },
      { nodeType: 'process', meta: { serverId: 'a' } },
    ] as any);
    expect(win.showErrorMessage).toHaveBeenCalledWith('No processes selected.');
  });

  it('aborts when no other connected target server exists', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    vi.mocked(getConnectedIds).mockReturnValue(['srvA']);
    await deployMultipleProcessesToServerCommand(undefined, [node('P1', 'srvA'), node('P2', 'srvA')]);
    expect(win.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No other connected servers'),
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('happy path: GET each + deployProcess(targetCfg) per node, no rename', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    vi.mocked(getConnectedIds).mockReturnValue(['srvA', 'srvB']);
    win.showQuickPick.mockResolvedValueOnce({ id: 'srvB', label: 'srvB' });
    // Fresh object per call: parseBody empties `body` after reading it.
    vi.mocked(apiRequest).mockImplementation(async () => ({ statusCode: 200, body: JSON.stringify(FAKE_PROCESS) }) as any);

    await deployMultipleProcessesToServerCommand(undefined, [node('P1', 'srvA'), node('P2', 'srvA')]);

    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(deployProcess).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deployProcess).mock.calls[0][0]).toBe('P1');
    expect(vi.mocked(deployProcess).mock.calls[1][0]).toBe('P2');
    expect(win.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('2 processes'));
  });

  it('reports failures per process without aborting loop', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    vi.mocked(getConnectedIds).mockReturnValue(['srvA', 'srvB']);
    win.showQuickPick.mockResolvedValueOnce({ id: 'srvB', label: 'srvB' });
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 500, body: '' } as any)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(FAKE_PROCESS) } as any);

    await deployMultipleProcessesToServerCommand(undefined, [node('P1', 'srvA'), node('P2', 'srvA')]);

    expect(deployProcess).toHaveBeenCalledTimes(1);
    expect(win.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('1/2 deployed'),
      expect.any(Object),
    );
  });
});

describe('exportSelectedProcessesCommand', () => {
  it('errors when no process nodes selected', async () => {
    await exportSelectedProcessesCommand(undefined, []);
    expect(win.showErrorMessage).toHaveBeenCalledWith('No processes selected.');
  });

  it('errors when selection spans multiple source servers', async () => {
    await exportSelectedProcessesCommand(undefined, [node('P1', 'a'), node('P2', 'b')]);
    expect(win.showErrorMessage).toHaveBeenCalledWith(
      'All selected processes must come from the same source server.',
    );
  });

  it('aborts silently when folder dialog cancelled', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    win.showOpenDialog.mockResolvedValueOnce(undefined);
    await exportSelectedProcessesCommand(undefined, [node('P1', 'a')]);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('happy path: writes <name>.pro per node into target dir', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    win.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/tmp/out' }]);
    vi.mocked(apiRequest).mockImplementation(async () => ({ statusCode: 200, body: JSON.stringify(FAKE_PROCESS) }) as any);

    await exportSelectedProcessesCommand(undefined, [node('P1', 'a'), node('P2', 'a')]);

    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    const paths = vi.mocked(fs.writeFileSync).mock.calls.map(c => c[0]);
    expect(paths).toEqual(['/tmp/out/P1.pro', '/tmp/out/P2.pro']);
    const firstContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(firstContent).toContain('602,"P1"');
  });

  it('per-process failures collected, others still written', async () => {
    vi.mocked(getServerConfig).mockReturnValue(FAKE_CFG);
    win.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/tmp/out' }]);
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 404, body: '' } as any)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(FAKE_PROCESS) } as any);

    await exportSelectedProcessesCommand(undefined, [node('Px', 'a'), node('P2', 'a')]);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(win.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('1/2 exported'));
  });
});
