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

import { readProcess, readRules } from '../../git/workspaceReader';
import { writeProcess, writeRules } from '../../git/workspaceWriter';
import type { TM1Process } from '../../git/serializer';

function makeProcess(overrides: Partial<TM1Process> = {}): TM1Process {
  return {
    name: 'P', prolog: 'sP();', metadata: '', data: '', epilog: '',
    parameters: [], variables: [], dataSource: { Type: 'None' }, hasSecurity: false,
    ...overrides,
  };
}

beforeEach(() => { fileStore.clear(); });

describe('workspaceReader', () => {
  describe('readProcess', () => {
    it('reads a process previously written', async () => {
      const original = makeProcess({ name: 'Foo', prolog: 'sP();\n', data: 'sD();\n' });
      await writeProcess('/tm1/srv', original);
      const got = await readProcess('/tm1/srv', 'Foo');
      expect(got).toEqual(original);
    });

    it('returns null when both files missing', async () => {
      expect(await readProcess('/tm1/srv', 'Missing')).toBeNull();
    });

    it('returns null when only .ti present', async () => {
      fileStore.set('/tm1/srv/processes/Half.ti', '#region prolog\n\n#endregion prolog');
      expect(await readProcess('/tm1/srv', 'Half')).toBeNull();
    });

    it('returns null when only .json present', async () => {
      fileStore.set('/tm1/srv/processes/Half.json', '{"version":1,"name":"Half"}');
      expect(await readProcess('/tm1/srv', 'Half')).toBeNull();
    });

    it('throws helpful error when header JSON malformed', async () => {
      fileStore.set('/tm1/srv/processes/Bad.ti', '');
      fileStore.set('/tm1/srv/processes/Bad.json', '{not-json');
      await expect(readProcess('/tm1/srv', 'Bad')).rejects.toThrow();
    });

    it('handles sanitized name lookup (foo/bar → foo_bar)', async () => {
      const original = makeProcess({ name: 'foo/bar' });
      await writeProcess('/tm1/srv', original);
      const got = await readProcess('/tm1/srv', 'foo/bar');
      expect(got?.name).toBe('foo/bar');
    });
  });

  describe('readRules', () => {
    it('reads rules previously written', async () => {
      await writeRules('/tm1/srv', 'Sales', "['A'] = N: 1;");
      expect(await readRules('/tm1/srv', 'Sales')).toBe("['A'] = N: 1;");
    });

    it('returns null when missing', async () => {
      expect(await readRules('/tm1/srv', 'Missing')).toBeNull();
    });
  });
});
