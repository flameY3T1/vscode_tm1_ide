// src/test/providers/contextListFetch.test.ts
//
// The server lists for context completion, since 2026-09-20 in ONE
// place (`providers/contextListFetch.ts`).
//
// The reason: the same five fetches were written out in the host of the TI console
// and in the host of the process editor — and they had already drifted apart.
// The console sent the parameter type narrowed (`'Numeric' | 'String'`), the
// editor the raw string from the server, although the CLIENT is the same
// for both. The last test here pins down that they do not drift
// apart again.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const fetchNames = vi.hoisted(() => vi.fn());
const listCubes = vi.hoisted(() => vi.fn());
const listProcesses = vi.hoisted(() => vi.fn());
const listHierarchyNames = vi.hoisted(() => vi.fn());

vi.mock('../../providers/fetchNames', () => ({ fetchNames }));
vi.mock('../../tm1Rest/cubeApi', () => ({ listCubes }));
vi.mock('../../tm1Rest/processApi', () => ({ listProcesses }));
vi.mock('../../tm1Rest/dimensionApi', () => ({ listHierarchyNames }));

import {
  fetchCubeNames, fetchCubesWithDims, fetchDimensionNames, fetchHierarchyNamesFor,
  fetchProcessList,
} from '../../providers/contextListFetch';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'http://t' } as Tm1Config;

beforeEach(() => { vi.resetAllMocks(); });

describe('Namenslisten', () => {
  it('sorts the cubes and leaves the source untouched', async () => {
    const original = ['Sales', 'Costs'];
    fetchNames.mockResolvedValue(original);
    expect(await fetchCubeNames(cfg)).toEqual(['Costs', 'Sales']);
    // `.slice()` before sorting: `fetchNames` returns its CACHE.
    expect(original).toEqual(['Sales', 'Costs']);
  });

  it('sorts the dimensions', async () => {
    fetchNames.mockResolvedValue(['Zeit', 'Region']);
    expect(await fetchDimensionNames(cfg)).toEqual(['Region', 'Zeit']);
  });

  it('sorts the hierarchies of the requested dimension', async () => {
    listHierarchyNames.mockResolvedValue(['B', 'A']);
    expect(await fetchHierarchyNamesFor(cfg, 'Region')).toEqual(['A', 'B']);
    expect(listHierarchyNames).toHaveBeenCalledWith(cfg, 'Region');
  });
});

describe('Prozessliste', () => {
  it('narrows the parameter type — everything except `Numeric` is `String`', async () => {
    // Exactly the difference between the two hosts: the editor passed
    // through whatever the server wrote.
    listProcesses.mockResolvedValue([{
      Name: 'Load',
      Parameters: [
        { Name: 'pZahl', Type: 'Numeric' },
        { Name: 'pText', Type: 'String' },
        { Name: 'pKrumm', Type: 'Something' },
        { Name: 'pLeer' },
      ],
    }]);
    const [proc] = await fetchProcessList(cfg);
    expect(proc.params.map(p => p.type)).toEqual(['Numeric', 'String', 'String', 'String']);
  });

  it('builds the signature from the parameter names', async () => {
    listProcesses.mockResolvedValue([
      { Name: 'Load', Parameters: [{ Name: 'pA' }, { Name: 'pB' }] },
      { Name: 'Ohne', Parameters: [] },
    ]);
    const procs = await fetchProcessList(cfg);
    expect(procs[0].sig).toBe('(pA, pB)');
    // No empty pair of parentheses: completion appends `sig` to the name.
    expect(procs[1].sig).toBe('');
  });

  it('asks for Name AND Parameters, sorted by the server', async () => {
    listProcesses.mockResolvedValue([]);
    await fetchProcessList(cfg);
    expect(listProcesses).toHaveBeenCalledWith(cfg,
      expect.objectContaining({ select: 'Name,Parameters', orderby: 'Name' }));
  });
});

describe('cubes with their dimensions', () => {
  it('takes the expand apart', async () => {
    listCubes.mockResolvedValue([
      { Name: 'Sales', Dimensions: [{ Name: 'Region' }, { Name: 'Zeit' }] },
      { Name: 'Leer' },
    ]);
    expect(await fetchCubesWithDims(cfg)).toEqual([
      { name: 'Sales', dims: ['Region', 'Zeit'] },
      { name: 'Leer', dims: [] },
    ]);
  });
});

describe('A failure is an EMPTY list, not a missing answer', () => {
  // Otherwise the client waits forever, and the suggestions stay away on every
  // further attempt as well.
  const faelle: Array<[string, () => Promise<unknown>]> = [
    ['fetchCubes', () => fetchCubeNames(cfg)],
    ['fetchDimensions', () => fetchDimensionNames(cfg)],
    ['fetchHierarchies', () => fetchHierarchyNamesFor(cfg, 'Region')],
    ['fetchProcesses', () => fetchProcessList(cfg)],
    ['fetchCubesWithDims', () => fetchCubesWithDims(cfg)],
  ];

  it.each(faelle)('%s returns [] instead of throwing', async (_name, run) => {
    const boom = (): never => { throw new Error('HTTP 500'); };
    fetchNames.mockImplementation(boom);
    listCubes.mockImplementation(boom);
    listProcesses.mockImplementation(boom);
    listHierarchyNames.mockImplementation(boom);
    await expect(run()).resolves.toEqual([]);
  });

  it('reports the failure when a listener is present', async () => {
    fetchNames.mockRejectedValue(new Error('HTTP 500'));
    const onError = vi.fn();
    expect(await fetchCubeNames(cfg, onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith('fetchCubes', expect.any(Error));
  });

  it('stays silent without a listener — the TI console wants it that way', async () => {
    fetchNames.mockRejectedValue(new Error('HTTP 500'));
    await expect(fetchCubeNames(cfg)).resolves.toEqual([]);
  });
});

describe('The fetches live in ONE place', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const HOSTS = [
    'src/webviews/tiConsoleWebview.ts',
    'src/commands/processEditor/messaging.ts',
  ] as const;

  it.each(HOSTS)('%s does not build the process list itself', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // `select: 'Name,Parameters'` is the anchor: it occurs exactly once in the
    // chain, namely in the shared module.
    expect(src).not.toContain("select: 'Name,Parameters'");
  });

  it.each(HOSTS)('%s no longer carries the 10000 limit itself', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).not.toContain('top: 10000');
  });
});
