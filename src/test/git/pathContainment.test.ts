import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { writeFileEnsuringDir, writeProcess } from '../../git/workspaceWriter';
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

describe('workspaceWriter path containment', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tm1-mirror-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('(a) writes a normal sanitized name to the expected path', async () => {
    const serverDir = path.join(root, 'srv');
    await writeProcess(serverDir, makeProcess({ name: 'Foo' }));
    const ti = path.join(serverDir, 'processes', 'Foo.ti');
    const json = path.join(serverDir, 'processes', 'Foo.json');
    expect((await stat(ti)).isFile()).toBe(true);
    expect((await stat(json)).isFile()).toBe(true);
    expect(await readFile(ti, 'utf8')).toContain('#region Prolog');
  });

  it('(b) throws (and does not write) when filePath resolves outside the root', async () => {
    const subdir = path.join(root, 'srv', 'processes');
    const escaping = path.join(subdir, '..', '..', 'evil.ti');
    await expect(writeFileEnsuringDir(subdir, escaping, 'pwned')).rejects.toThrow(/outside mirror root/);
    // Nothing must have been written at the escaped location.
    await expect(stat(path.join(root, 'evil.ti'))).rejects.toBeTruthy();
  });

  it('(b) allows a path exactly at the root subtree', async () => {
    const subdir = path.join(root, 'srv', 'processes');
    const good = path.join(subdir, 'Ok.ti');
    await writeFileEnsuringDir(subdir, good, 'x');
    expect((await stat(good)).isFile()).toBe(true);
  });
});
