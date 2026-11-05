import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../providers/serverConfigForFile', () => ({ resolveDir: () => ({ serverDir: '/repo/srv', serverName: 'srv' }) }));
vi.mock('../../git/workspaceWriter', () => ({ writeProcess: vi.fn(async () => {}), writeRules: vi.fn() }));
vi.mock('../../git/processFetcher', () => ({ fetchProcess: vi.fn() }));

import * as vscode from 'vscode';
import { mirrorProcessAfterSave } from '../../commands/git/mirror';
import { writeProcess } from '../../git/workspaceWriter';
import { fetchProcess } from '../../git/processFetcher';
import { PROCESS_HEADER_SELECT } from '../../tm1Rest/processApi';
import type { TM1Process } from '../../git/serializer';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' } as Tm1Config;
const EDITOR: TM1Process = {
  name: 'P', prolog: 'new;', metadata: '', data: '', epilog: '',
  parameters: [], variables: [], dataSource: { Type: 'None' } as TM1Process['dataSource'], hasSecurity: false,
};
// Server read shape: a field the editor form drops, an empty UIData.
const SERVER_HEADER: TM1Process = {
  ...EDITOR, prolog: '', uiData: '', variablesUiData: [],
  dataSource: { Type: 'TM1CubeView', dataSourceNameForClient: 'S', dataSourceNameForServer: 'S', view: 'All' } as TM1Process['dataSource'],
};

const fetchMock = vi.mocked(fetchProcess);
const writeMock = vi.mocked(writeProcess);

beforeEach(() => {
  fetchMock.mockReset();
  writeMock.mockClear();
  vi.mocked(vscode.window.showWarningMessage).mockClear?.();
});

describe('mirrorProcessAfterSave', () => {
  it('writes the code just sent with the header the server holds, reading no procedures', async () => {
    fetchMock.mockResolvedValueOnce(SERVER_HEADER);
    await mirrorProcessAfterSave(EDITOR, CFG);
    expect(fetchMock).toHaveBeenCalledWith('P', CFG, PROCESS_HEADER_SELECT);
    expect(PROCESS_HEADER_SELECT).not.toMatch(/Procedure/);
    expect(writeMock).toHaveBeenCalledWith('/repo/srv', { ...SERVER_HEADER, prolog: 'new;' });
  });

  it('writes the editor state and warns when the server read fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('503'));
    await mirrorProcessAfterSave(EDITOR, CFG);
    expect(writeMock).toHaveBeenCalledWith('/repo/srv', { ...EDITOR, v12: false });
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('runs two quick saves of one process in order, even when the first read is slower', async () => {
    let releaseFirst!: () => void;
    fetchMock
      .mockImplementationOnce(() => new Promise(r => { releaseFirst = () => r(SERVER_HEADER); }))
      .mockResolvedValueOnce(SERVER_HEADER);
    const first = mirrorProcessAfterSave({ ...EDITOR, prolog: 'first;' }, CFG);
    const second = mirrorProcessAfterSave({ ...EDITOR, prolog: 'second;' }, CFG);
    await new Promise(r => setTimeout(r, 0));
    releaseFirst();
    await Promise.all([first, second]);
    expect(writeMock.mock.calls.map(c => c[1].prolog)).toEqual(['first;', 'second;']);
  });
});
