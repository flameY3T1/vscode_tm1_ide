import { describe, it, expect, vi, beforeEach } from 'vitest';

const fileStore = new Map<string, string>();
vi.mock('fs/promises', () => ({
  default: {},
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (path: string, content: string) => { fileStore.set(path, content); }),
}));

import { writeProcess, writeRules } from '../../git/workspaceWriter';
import type { TM1Process } from '../../git/serializer';

function makeProcess(overrides: Partial<TM1Process> = {}): TM1Process {
  return {
    name: 'P',
    prolog: 'sP();', metadata: '', data: '', epilog: '',
    parameters: [], variables: [],
    dataSource: { Type: 'None' },
    hasSecurity: false,
    ...overrides,
  };
}

beforeEach(() => { fileStore.clear(); });

describe('workspaceWriter', () => {
  describe('writeProcess', () => {
    it('writes .ti and .json in processes/ subdir', async () => {
      await writeProcess('/tm1/srv', makeProcess({ name: 'Foo' }));
      const ti = Array.from(fileStore.keys()).find(p => p.endsWith('Foo.ti'));
      const json = Array.from(fileStore.keys()).find(p => p.endsWith('Foo.json'));
      expect(ti).toBe('/tm1/srv/processes/Foo.ti');
      expect(json).toBe('/tm1/srv/processes/Foo.json');
      expect(fileStore.get(ti!)).toContain('#region Prolog');
      const header = JSON.parse(fileStore.get(json!)!);
      expect(header.Name).toBe('Foo');
      expect(header.version).toBeUndefined();
    });

    it('sanitizes name with slashes', async () => {
      await writeProcess('/tm1/srv', makeProcess({ name: 'foo/bar' }));
      const ti = Array.from(fileStore.keys()).find(p => p.endsWith('.ti'));
      expect(ti).toBe('/tm1/srv/processes/foo_bar.ti');
    });

    it('overwrites existing files', async () => {
      await writeProcess('/tm1/srv', makeProcess({ name: 'X', prolog: 'old' }));
      await writeProcess('/tm1/srv', makeProcess({ name: 'X', prolog: 'new' }));
      const ti = fileStore.get('/tm1/srv/processes/X.ti');
      expect(ti).toContain('new');
      expect(ti).not.toContain('old');
    });
  });

  describe('writeRules', () => {
    it('writes .rux in rules/ subdir', async () => {
      await writeRules('/tm1/srv', 'SalesCube', "['A'] = N: 1;");
      expect(fileStore.get('/tm1/srv/rules/SalesCube.rux')).toBe("['A'] = N: 1;");
    });

    it('sanitizes cube name', async () => {
      await writeRules('/tm1/srv', 'a/b', 'rules');
      const file = Array.from(fileStore.keys()).find(p => p.endsWith('.rux'));
      expect(file).toBe('/tm1/srv/rules/a_b.rux');
    });
  });
});
