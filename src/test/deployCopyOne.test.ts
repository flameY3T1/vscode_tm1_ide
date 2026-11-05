// src/test/deployCopyOne.test.ts
//
// The shared copy chains (`deploy/copyOne.ts`) and what they
// are supposed to save.
//
// The occasion: the same chain stood three times in the tree, and the header of
// `deployObjects.ts` claimed meanwhile that it was "not reinvented". The
// last test here pins down that they do not drift apart again — no
// other gate sees a copy.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const cubeExists = vi.hoisted(() => vi.fn());
const probeViewKind = vi.hoisted(() => vi.fn());
const subsetExists = vi.hoisted(() => vi.fn());
const readViewForCopy = vi.hoisted(() => vi.fn());
const writeViewCopy = vi.hoisted(() => vi.fn());

vi.mock('../tm1Rest/cubeApi', () => ({ cubeExists, probeViewKind }));
vi.mock('../tm1Rest/subsetApi', () => ({
  subsetExists, getSubset: vi.fn(), listSubsetElementNames: vi.fn(),
}));
vi.mock('../tm1Rest/viewCopyApi', () => ({ readViewForCopy, writeViewCopy }));
vi.mock('../commands/dimension/dimensionSubsetSave', () => ({
  saveSubset: vi.fn(), saveExpressionSubset: vi.fn(), SAVE_CANCELLED: Symbol('cancelled'),
}));

import { copyViewToServer } from '../commands/deploy/copyOne';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg: Tm1Config = {
  serverUrl: 'http://t', username: 'u', password: 'p',
  authType: 'Basic', rejectUnauthorized: false,
};

/** A view with exactly one named subset reference. */
function viewWithNamedSubset(): unknown {
  return {
    kind: 'native',
    plan: {
      body: {},
      namedSubsets: [{ dim: 'Region', hier: 'Region', name: 'Top10' }],
      oversized: [], unreadable: 0,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  readViewForCopy.mockResolvedValue(viewWithNamedSubset());
  probeViewKind.mockResolvedValue(null);
  writeViewCopy.mockResolvedValue(undefined);
});

describe('copyViewToServer — without a known inventory', () => {
  it('queries cube and subset live', async () => {
    cubeExists.mockResolvedValue(true);
    subsetExists.mockResolvedValue(true);
    await copyViewToServer(cfg, cfg, 'Sales', 'ByRegion', false);
    expect(cubeExists).toHaveBeenCalledTimes(1);
    expect(subsetExists).toHaveBeenCalledTimes(1);
    expect(writeViewCopy).toHaveBeenCalledTimes(1);
  });
});

describe('copyViewToServer — with a known inventory (B12)', () => {
  it('does NOT query again what the check step has already read', async () => {
    await copyViewToServer(cfg, cfg, 'Sales', 'ByRegion', false, {
      cubes: new Set(['sales']),
      subsets: new Set(['region|region|top10']),
    });
    expect(cubeExists).not.toHaveBeenCalled();
    expect(subsetExists).not.toHaveBeenCalled();
    expect(writeViewCopy).toHaveBeenCalledTimes(1);
  });

  it('compares regardless of upper and lower case', async () => {
    // TM1 does not distinguish spelling in object names; the inventory is
    // keyed in lower case, the reference comes as it stands in the view.
    await copyViewToServer(cfg, cfg, 'SALES', 'ByRegion', false, {
      cubes: new Set(['sales']),
      subsets: new Set(['region|region|top10']),
    });
    expect(writeViewCopy).toHaveBeenCalledTimes(1);
  });

  it('reports the missing cube from the inventory, without asking', async () => {
    await expect(copyViewToServer(cfg, cfg, 'Sales', 'ByRegion', false, {
      cubes: new Set(['other']),
    })).rejects.toThrow(/does not exist on the target server/);
    expect(cubeExists).not.toHaveBeenCalled();
    expect(readViewForCopy).not.toHaveBeenCalled();
  });

  it('reports the missing subset from the inventory, without asking', async () => {
    await expect(copyViewToServer(cfg, cfg, 'Sales', 'ByRegion', false, {
      cubes: new Set(['sales']),
      subsets: new Set(),
    })).rejects.toThrow(/Subset "Top10"/);
    expect(subsetExists).not.toHaveBeenCalled();
    expect(writeViewCopy).not.toHaveBeenCalled();
  });

  it('takes a half inventory: what is missing gets queried', async () => {
    // `cubes` known, `subsets` not — then exactly ONE question may remain.
    cubeExists.mockResolvedValue(true);
    subsetExists.mockResolvedValue(true);
    await copyViewToServer(cfg, cfg, 'Sales', 'ByRegion', false, { cubes: new Set(['sales']) });
    expect(cubeExists).not.toHaveBeenCalled();
    expect(subsetExists).toHaveBeenCalledTimes(1);
  });
});

describe('the copy chains stand in ONE place', () => {
  const ROOT = path.resolve(__dirname, '../..');

  function sources(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'test' || e.name === 'test-integration') { continue; }
        sources(p, out);
      } else if (e.name.endsWith('.ts')) { out.push(p); }
    }
    return out;
  }

  /** Files that the pattern matches — without the one that may carry it. */
  function carriers(needle: RegExp, home: string): string[] {
    return sources(path.join(ROOT, 'src'))
      .filter(f => needle.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
      .filter(f => f !== home);
  }

  it('clears the OData meta fields only in copyOne.ts', () => {
    // State before merging: three times verbatim in the repo.
    expect(carriers(/const META_KEYS_RE = \/\^@odata/, 'src/commands/deploy/copyOne.ts'))
      .toEqual([]);
  });

  it('writes the axis check of a view only in copyOne.ts', () => {
    // `oversized` is the anchor: it occurs exactly once in the chain and
    // otherwise only where the view is READ (`tm1Rest/`).
    const carrying = carriers(
      /Axis of "\{0\}" holds too many members/, 'src/commands/deploy/copyOne.ts');
    expect(carrying).toEqual([]);
  });

  it('prepares a process for a copy only in copyOne.ts', () => {
    // `PrologProcedure` alone is no good as an anchor — half of the process editor
    // reads it. What makes the COPY is the mapping including
    // `VariablesUIData`: TM1 never reconciles the list with `Variables`, both
    // belong written together. `loadProcesses`/`processEditorUtils`
    // merge them for display, not for transfer.
    const mapping = carriers(
      /PrologProcedure[\s\S]{0,800}mergeVariableColumns/, 'src/commands/deploy/copyOne.ts');
    expect(mapping.filter(f => f.includes('/deploy/') || f.includes('/processEditor/deploy')))
      .toEqual([]);
  });
});
