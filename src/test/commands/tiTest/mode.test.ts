import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectSubMode, emptyDiffSummary } from '../../../commands/tiTest/mode';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'titest-mode-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

async function writeManifestRaw(folder: string, body: object): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(body), 'utf8');
}

describe('emptyDiffSummary', () => {
  it('returns zeroed shape with pass=false and statusDiff=false', () => {
    const s = emptyDiffSummary();
    expect(s).toEqual({
      pass: false,
      totalDiffs: 0,
      cellDiffs: 0,
      dimDiffs: 0,
      attrDiffs: 0,
      subsetDiffs: 0,
      viewDiffs: 0,
      cubeDiffs: 0,
      tranDiffs: 0,
      metaDiffs: 0,
      statusDiff: false,
    });
  });

  it('returns a fresh object each call', () => {
    const a = emptyDiffSummary();
    const b = emptyDiffSummary();
    expect(a).not.toBe(b);
    a.totalDiffs = 99;
    expect(b.totalDiffs).toBe(0);
  });
});

describe('detectSubMode', () => {
  it('detects real on-disk sub manifest (kind=ti-test-sub)', async () => {
    const parent = path.join(tmp, 'root');
    const subFolder = path.join(parent, 'subs', 'SubA');
    await writeManifestRaw(subFolder, {
      version: 2,
      kind: 'ti-test-sub',
      name: 'SubA',
      parent: 'root',
      rootTest: 'root',
      clonedFrom: 'P',
      parameters: [],
      callContext: { callerProcess: 'P', callerLine: 1, callIndex: 0 },
    });
    const res = await detectSubMode(subFolder);
    expect(res).toEqual({ parentFolder: parent, subName: 'SubA' });
  });

  it('returns null when on-disk manifest is root (kind=ti-test)', async () => {
    const folder = path.join(tmp, 'root');
    await writeManifestRaw(folder, {
      version: 2,
      kind: 'ti-test',
      name: 'root',
      process: 'P',
      schemaVersion: 1,
      active: true,
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
    });
    const res = await detectSubMode(folder);
    expect(res).toBeNull();
  });

  it('returns null when folder not under "subs/" and no manifest', async () => {
    const folder = path.join(tmp, 'random');
    await fs.mkdir(folder, { recursive: true });
    const res = await detectSubMode(folder);
    expect(res).toBeNull();
  });

  it('detects virtual sub when parent manifest declares it in subs[]', async () => {
    const parent = path.join(tmp, 'root');
    const subFolder = path.join(parent, 'subs', 'VirtA');
    await fs.mkdir(subFolder, { recursive: true });
    await writeManifestRaw(parent, {
      version: 2,
      kind: 'ti-test',
      name: 'root',
      process: 'P',
      schemaVersion: 1,
      active: true,
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
      subs: ['VirtA', 'VirtB'],
    });
    const res = await detectSubMode(subFolder);
    expect(res).toEqual({ parentFolder: parent, subName: 'VirtA' });
  });

  it('returns null when folder under subs/ but parent does not declare it', async () => {
    const parent = path.join(tmp, 'root');
    const subFolder = path.join(parent, 'subs', 'NotDeclared');
    await fs.mkdir(subFolder, { recursive: true });
    await writeManifestRaw(parent, {
      version: 2,
      kind: 'ti-test',
      name: 'root',
      process: 'P',
      schemaVersion: 1,
      active: true,
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
      subs: ['Other'],
    });
    const res = await detectSubMode(subFolder);
    expect(res).toBeNull();
  });

  it('returns null when folder under subs/ but parent manifest missing', async () => {
    const subFolder = path.join(tmp, 'root', 'subs', 'Orphan');
    await fs.mkdir(subFolder, { recursive: true });
    const res = await detectSubMode(subFolder);
    expect(res).toBeNull();
  });

  it('returns null when folder under subs/ but parent has no kind field (legacy v1)', async () => {
    const parent = path.join(tmp, 'root');
    const subFolder = path.join(parent, 'subs', 'X');
    await fs.mkdir(subFolder, { recursive: true });
    await writeManifestRaw(parent, {
      schemaVersion: 1,
      name: 'root',
      process: 'P',
      active: true,
      captured: { at: 'now', server: 's', extensionVersion: 'v' },
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
    });
    const res = await detectSubMode(subFolder);
    expect(res).toBeNull();
  });
});
