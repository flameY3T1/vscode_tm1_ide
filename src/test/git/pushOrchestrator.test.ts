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

// Only the network is faked; assertOk stays real so errors keep their shape.
vi.mock('../../tm1Rest/client', async (orig) => ({
  ...(await orig<typeof import('../../tm1Rest/client')>()),
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { pushProcessFrom, pushRulesFrom } from '../../git/pushOrchestrator';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };
import { writeProcess, writeRules } from '../../git/workspaceWriter';
import type { TM1Process } from '../../git/serializer';

const mockApi = vi.mocked(apiRequest);
beforeEach(() => { fileStore.clear(); mockApi.mockReset(); });

function makeProcess(o: Partial<TM1Process> = {}): TM1Process {
  return {
    name: 'P', prolog: 'sP();', metadata: '', data: '', epilog: '',
    parameters: [], variables: [], dataSource: { Type: 'None' }, hasSecurity: false,
    ...o,
  };
}

describe('pushOrchestrator', () => {
  describe('pushProcessFrom', () => {
    it('reads local process and PATCHes server', async () => {
      await writeProcess('/tm1/srv', makeProcess({ name: 'Foo', prolog: 'A;\n' }));
      mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

      await pushProcessFrom('/tm1/srv', 'srv', 'Foo', CFG);

      expect(mockApi).toHaveBeenCalledTimes(1);
      const [m1, , body1] = mockApi.mock.calls[0];
      expect(m1).toBe('PATCH');
      const payload = JSON.parse(body1 as string);
      expect(payload.PrologProcedure).toBe('A;\n');
    });

    it.each([
      // 11.x: the break before #endregion is code (TM1's own Code split); 12 always writes it as separator.
      ['11.x', CFG, false, 'A;\n\n'],
      ['12', { ...CFG, authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'Admin' } } as Tm1Config, true, 'A;\n'],
    ])('reads the file in the %s layout of the target server, losing no trailing line', async (_l, cfg, v12, prolog) => {
      await writeProcess('/tm1/srv', makeProcess({ name: 'Foo', prolog, v12 }));
      mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

      await pushProcessFrom('/tm1/srv', 'srv', 'Foo', cfg);

      expect(JSON.parse(mockApi.mock.calls[0][2] as string).PrologProcedure).toBe(prolog);
    });

    it('throws when local process missing', async () => {
      await expect(pushProcessFrom('/tm1/srv', 'srv', 'Missing', CFG)).rejects.toThrow(/local files/i);
    });
  });

  describe('pushRulesFrom', () => {
    it('reads local rules and PATCHes server', async () => {
      await writeRules('/tm1/srv', 'Sales', "['A'] = N: 1;");
      mockApi.mockResolvedValue({ statusCode: 204, body: '' } as any);

      await pushRulesFrom('/tm1/srv', 'srv', 'Sales', CFG);

      const [m, p, body] = mockApi.mock.calls[0];
      expect(m).toBe('PATCH');
      expect(p).toContain("Cubes('Sales')");
      expect(JSON.parse(body as string)).toEqual({ Rules: "['A'] = N: 1;" });
    });

    it('throws when local rules missing', async () => {
      await expect(pushRulesFrom('/tm1/srv', 'srv', 'Missing', CFG)).rejects.toThrow(/local files/i);
    });
  });
});
