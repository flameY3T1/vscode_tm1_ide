import { describe, it, expect, vi, beforeEach } from 'vitest';

const fileStore = new Map<string, string>();
class ENOENT extends Error { code = 'ENOENT'; constructor(p: string) { super('ENOENT: ' + p); } }
vi.mock('fs/promises', () => ({
  default: {},
  readFile: vi.fn(async (p: string) => {
    if (!fileStore.has(p)) { throw new ENOENT(p); }
    return fileStore.get(p)!;
  }),
  writeFile: vi.fn(async (p: string, c: string) => { fileStore.set(p, c); }),
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async (p: string) => {
    if (!fileStore.has(p)) { throw new ENOENT(p); }
    // Like the real `stat`: the stub must support `isFile()`, otherwise a
    // caller that correctly checks for it sees every file as nonexistent.
    return { isFile: () => true, isDirectory: () => false } as unknown;
  }),
}));

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: (res: { statusCode: number; body: string }, context?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = context ? `${context}: ` : '';
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${res.body}`);
    }
  },
}));
vi.mock('../../commands/serverManager', () => ({
  getServerConfig: vi.fn((_id: string) => ({ serverUrl: 'https://example:8010', username: 'admin', password: '', rejectUnauthorized: false })),
  getServerProfile: vi.fn(() => ({ name: 'TestSrv' })),
  getServerIdByUrl: vi.fn(() => 'srv-id'),
  getGitProfile: vi.fn((_id: string) => ({ enabled: true, repoPath: '/tmp/tm1-test', parallelFetch: 4 })),
}));

import * as vscode from 'vscode';
import { apiRequest } from '../../tm1Rest/client';
import { pullProcessCommand, pushProcessCommand, pullRulesCommand, pushRulesCommand, pullAllCommand } from '../../commands/git';

const mockApi = vi.mocked(apiRequest);

beforeEach(() => {
  fileStore.clear();
  mockApi.mockReset();
  vi.mocked(vscode.window.showWarningMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(vscode.window.showInformationMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(vscode.window.showErrorMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn((key: string) => {
      if (key === 'repoPath') { return '/tmp/tm1-test'; }
      if (key === 'parallelFetch') { return 4; }
      return undefined;
    }),
  } as any);
  (vscode.workspace as any).workspaceFolders = undefined;
});

const node = { meta: { serverId: 'srv-id', processName: 'P', cubeName: 'C' } } as any;

describe('git commands (vscode-side)', () => {
  describe('pullProcessCommand', () => {
    it('happy path: fetches + writes', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'sP();', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);

      await pullProcessCommand(node);

      expect(fileStore.has('/tmp/tm1-test/TestSrv/processes/P.ti')).toBe(true);
      expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalled();
    });

    it('errors when no node passed (no server context)', async () => {
      await pullProcessCommand(undefined);
      expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalled();
      expect(fileStore.size).toBe(0);
    });

    it('pull overwrites local file without prompting', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'old', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);
      await pullProcessCommand(node);

      fileStore.set('/tmp/tm1-test/TestSrv/processes/P.ti', 'TAINTED');

      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'new', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);
      await pullProcessCommand(node);

      const ti = fileStore.get('/tmp/tm1-test/TestSrv/processes/P.ti');
      expect(ti).toContain('new');
      expect(vi.mocked(vscode.window.showWarningMessage)).not.toHaveBeenCalled();
    });
  });

  describe('pushProcessCommand', () => {
    it('cancels when modal dismissed', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'x', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);
      await pullProcessCommand(node);
      mockApi.mockReset();

      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as any);
      await pushProcessCommand(node);

      expect(mockApi).not.toHaveBeenCalled();
    });

    it('pushes when modal confirmed', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'x', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);
      await pullProcessCommand(node);
      mockApi.mockReset();

      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, push' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: '' } as any)
        .mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

      await pushProcessCommand(node);

      const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
      expect(patchCall).toBeDefined();
    });
  });

  describe('pullRulesCommand', () => {
    it('happy path', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ value: "['A'] = N: 1;" }),
      } as any);
      await pullRulesCommand(node);
      expect(fileStore.get('/tmp/tm1-test/TestSrv/rules/C.rux')).toBe("['A'] = N: 1;");
    });
  });

  describe('pushRulesCommand', () => {
    it('pushes when confirmed', async () => {
      mockApi.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: 'rules-text' }) } as any);
      await pullRulesCommand(node);
      mockApi.mockReset();

      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, push' as any);
      mockApi.mockResolvedValue({ statusCode: 204, body: '' } as any);
      await pushRulesCommand(node);

      const patchCall = mockApi.mock.calls.find(c => c[0] === 'PATCH');
      expect(patchCall).toBeDefined();
      expect(JSON.parse(patchCall![2] as string).Rules).toBe('rules-text');
    });
  });

  describe('pullAllCommand', () => {
    it('mirrors control objects too — processes AND rules of system cubes', async () => {
      // The filter on `}` threw away the Bedrock library and the rules of the
      // attribute and system cubes. Both are the modeler's work.
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'P1' }, { Name: '}bedrock.cube.clone' }] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'C1' }, { Name: '}ElementAttributes_Region' }, { Name: '}CellSecurity_Sales' }] }) } as any)
        // Fresh object per call: parseBody releases the body it read.
        .mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify({ PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' }, value: 'rules' }),
        }) as any);

      await pullAllCommand(node);

      expect(fileStore.has('/tmp/tm1-test/TestSrv/processes/P1.ti')).toBe(true);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/processes/}bedrock.cube.clone.ti')).toBe(true);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/rules/C1.rux')).toBe(true);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/rules/}ElementAttributes_Region.rux')).toBe(true);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/rules/}CellSecurity_Sales.rux')).toBe(true);
    });

    it('iterates processes + cubes from server', async () => {
      // repoPath /tmp/tm1-test lives in a git work tree → guard passes
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'P1' }, { Name: '}SystemProc' }] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'C1' }, { Name: '}SystemCube' }] }) } as any)
        // Fresh object per call: parseBody releases the body it read.
        .mockImplementation(async () => ({
          statusCode: 200,
          body: JSON.stringify({ PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
        }) as any);

      await pullAllCommand(node);

      expect(fileStore.has('/tmp/tm1-test/TestSrv/processes/P1.ti')).toBe(true);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/processes/}SystemProc.ti')).toBe(true);
    });

    it('queues only cubes that actually carry rule text', async () => {
      // The rule text already comes from the cube list. Cubes without rules
      // therefore no longer produce an empty `.rux` — and not a single
      // fetch per cube is needed.
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
          { Name: 'Sales', Rules: "['Amount']=N:1;" },
          { Name: '}ElementAttributes_Region', Rules: '' },
          { Name: 'Empty', Rules: '' },
        ] }) } as any);

      await pullAllCommand(node);

      expect(fileStore.get('/tmp/tm1-test/TestSrv/rules/Sales.rux')).toBe("['Amount']=N:1;");
      expect(fileStore.has('/tmp/tm1-test/TestSrv/rules/Empty.rux')).toBe(false);
      expect(fileStore.has('/tmp/tm1-test/TestSrv/rules/}ElementAttributes_Region.rux')).toBe(false);
      // Exactly the two list fetches, no third.
      expect(mockApi).toHaveBeenCalledTimes(2);
    });

    it('empties a mirrored rule file when the server no longer has rules', async () => {
      // Otherwise the repo would keep a text that no longer exists on the
      // server — the reason why a rule-less cube WITH a local file
      // still goes into the queue.
      fileStore.set('/tmp/tm1-test/.git', '');
      fileStore.set('/tmp/tm1-test/TestSrv/rules/Sales.rux', "['Amount']=N:1;");
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales', Rules: '' }] }) } as any);

      await pullAllCommand(node);

      expect(fileStore.get('/tmp/tm1-test/TestSrv/rules/Sales.rux')).toBe('');
    });

    it('falls back to one fetch per cube when the list carries no Rules property', async () => {
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) } as any)
        .mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: 'from-fetch' }) } as any);

      await pullAllCommand(node);

      expect(fileStore.get('/tmp/tm1-test/TestSrv/rules/Sales.rux')).toBe('from-fetch');
      expect(mockApi).toHaveBeenCalledTimes(3);
    });

    // A mirror outside a repo is allowed, just not backed up: the
    // notice is in the confirmation dialog, it no longer blocks the way.
    it('warns instead of refusing when target dir is not inside a git repository', async () => {
      fileStore.delete('/tmp/tm1-test/.git');

      await pullAllCommand(node);

      expect(vi.mocked(vscode.window.showErrorMessage)).not.toHaveBeenCalled();
      const [, options, label] = vi.mocked(vscode.window.showWarningMessage).mock.calls[0] as unknown as [string, { modal: boolean; detail?: string }, string];
      expect(options.modal).toBe(true);
      expect(options.detail).toContain('/tmp/tm1-test/TestSrv');
      expect(label).toBe('Pull anyway');
      // Dialog not confirmed (the stub's default: undefined) -> no fetch.
      expect(mockApi).not.toHaveBeenCalled();
      expect(fileStore.size).toBe(0);
    });

    it('pulls without a git repository once the warning is confirmed', async () => {
      fileStore.delete('/tmp/tm1-test/.git');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Pull anyway' as any);
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales', Rules: "['Amount']=N:1;" }] }) } as any);

      await pullAllCommand(node);

      expect(fileStore.get('/tmp/tm1-test/TestSrv/rules/Sales.rux')).toBe("['Amount']=N:1;");
    });

    it('carries no detail line when the target dir IS inside a git repository', async () => {
      fileStore.set('/tmp/tm1-test/.git', '');

      await pullAllCommand(node);

      const [, options, label] = vi.mocked(vscode.window.showWarningMessage).mock.calls[0] as unknown as [string, { modal: boolean; detail?: string }, string];
      expect(options.detail).toBeUndefined();
      expect(label).toBe('Yes, pull all');
    });

    it('cancels (no fetch) when confirmation modal is dismissed', async () => {
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as any);

      await pullAllCommand(node);

      expect(mockApi).not.toHaveBeenCalled();
    });

    it('appends a cancelled note to the final toast when cancelled mid-run', async () => {
      fileStore.set('/tmp/tm1-test/.git', '');
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, pull all' as any);
      // Run the progress task with an already-cancelled token so no jobs run.
      vi.mocked(vscode.window.withProgress).mockImplementationOnce(async (_o: any, task: any) => {
        const progress = { report: vi.fn() };
        const token = { isCancellationRequested: true, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) };
        return task(progress, token);
      });
      mockApi
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'P1' }] }) } as any)
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'C1' }] }) } as any);

      await pullAllCommand(node);

      const msg = vi.mocked(vscode.window.showInformationMessage).mock.calls.at(-1)?.[0];
      expect(msg).toContain('cancelled before completion');
    });
  });
});
