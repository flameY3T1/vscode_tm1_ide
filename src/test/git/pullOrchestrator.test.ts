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
}));

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { pullProcessTo, pullRulesTo } from '../../git/pullOrchestrator';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

const mockApi = vi.mocked(apiRequest);
beforeEach(() => { fileStore.clear(); mockApi.mockReset(); });

describe('pullOrchestrator', () => {
  describe('pullProcessTo', () => {
    it('fetches process, writes 2 files, returns {name,kind,key}, no manifest', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          Name: 'P', PrologProcedure: 'sP();', MetadataProcedure: '',
          DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [],
          DataSource: { Type: 'None' },
        }),
      } as any);

      const result = await pullProcessTo('/tm1/srv', 'srv', 'P', CFG);
      expect(result).toEqual({ name: 'P', kind: 'process', key: 'processes/P' });

      expect(fileStore.has('/tm1/srv/processes/P.ti')).toBe(true);
      expect(fileStore.has('/tm1/srv/processes/P.json')).toBe(true);
      expect(fileStore.has('/tm1/srv/.meta/manifest.json')).toBe(false);
    });

    it('blindly overwrites local files even if they differ from server (no dirty check)', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'old', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);
      await pullProcessTo('/tm1/srv', 'srv', 'P', CFG);

      fileStore.set('/tm1/srv/processes/P.ti', 'LOCAL DIRTY EDIT');

      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Name: 'P', PrologProcedure: 'new', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '', Parameters: [], Variables: [], DataSource: { Type: 'None' } }),
      } as any);

      await expect(pullProcessTo('/tm1/srv', 'srv', 'P', CFG)).resolves.toBeDefined();
      expect(fileStore.get('/tm1/srv/processes/P.ti')).toContain('new');
    });

    it('propagates fetcher errors (no partial write)', async () => {
      mockApi.mockResolvedValue({ statusCode: 404, body: '' } as any);
      await expect(pullProcessTo('/tm1/srv', 'srv', 'Missing', CFG)).rejects.toThrow();
      expect(fileStore.size).toBe(0);
    });
  });

  describe('pullRulesTo', () => {
    it('fetches rules, writes .rux, returns {name,kind,key}, no manifest', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ '@odata.context': '...', value: "['A'] = N: 5;" }),
      } as any);

      const result = await pullRulesTo('/tm1/srv', 'srv', 'SalesCube', CFG);
      expect(result).toEqual({ name: 'SalesCube', kind: 'rules', key: 'rules/SalesCube' });
      expect(fileStore.get('/tm1/srv/rules/SalesCube.rux')).toBe("['A'] = N: 5;");
      expect(fileStore.has('/tm1/srv/.meta/manifest.json')).toBe(false);
    });

    it('handles 204 (cube without rules) — writes empty .rux', async () => {
      mockApi.mockResolvedValue({ statusCode: 204, body: '' } as any);
      await pullRulesTo('/tm1/srv', 'srv', 'EmptyCube', CFG);
      expect(fileStore.get('/tm1/srv/rules/EmptyCube.rux')).toBe('');
    });
  });
});
