import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TiTestTreeProvider } from '../../../views/tiTestTreeProvider';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'titt-subs-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('TiTestTreeProvider — sub children', () => {
  it('exposes a sub-folder as a child of its root test', async () => {
    const testDir = path.join(tmp, 'demo', 't1');
    await fs.mkdir(path.join(testDir, 'subs', 'Sub.A', 'data'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 't1',
        process: 't1',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['Sub.A'],
      }),
    );
    await fs.writeFile(
      path.join(testDir, 'subs', 'Sub.A', 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test-sub',
        name: 'Sub.A',
        parent: '../..',
        rootTest: 't1',
        clonedFrom: 'Sub.A',
        parameters: [],
        callContext: { callerProcess: 't1', callerLine: 1, callIndex: 0 },
        active: true,
      }),
    );

    const provider = new TiTestTreeProvider(() => tmp);
    await provider.refresh();

    // collectTestsBelow includes the sub
    const tests = provider.collectTestsBelow(undefined);
    expect(tests.some((t) => (t.manifest as { name: string }).name === 'Sub.A')).toBe(true);

    // findItemByFolder finds the root test item
    const item = provider.findItemByFolder(testDir);
    expect(item).toBeDefined();
    expect(item!.node.kind).toBe('test');

    // getChildren on the test item yields the sub
    const children = await provider.getChildren(item);
    expect(children?.some((c) => c.node.kind === 'sub' && c.label === 'Sub.A')).toBe(true);
  });

  it('sub item has tiTest.sub contextValue', async () => {
    const testDir = path.join(tmp, 'proj', 'mytest');
    await fs.mkdir(path.join(testDir, 'subs', 'SubX'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 'mytest',
        process: 'mytest',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['SubX'],
      }),
    );
    await fs.writeFile(
      path.join(testDir, 'subs', 'SubX', 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test-sub',
        name: 'SubX',
        parent: '../..',
        rootTest: 'mytest',
        clonedFrom: 'SubX',
        parameters: [],
        callContext: { callerProcess: 'mytest', callerLine: 5, callIndex: 0 },
        active: true,
      }),
    );

    const provider = new TiTestTreeProvider(() => tmp);
    await provider.refresh();
    const item = provider.findItemByFolder(testDir);
    const children = await provider.getChildren(item);
    const sub = children?.find((c) => c.label === 'SubX');
    expect(sub).toBeDefined();
    expect(sub!.contextValue).toBe('tiTest.sub');
  });

  it('synthesizes sub-nodes from manifest.subs[] when subs/ folder is empty', async () => {
    const testDir = path.join(tmp, 'synth', 'rootTest');
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 'rootTest',
        process: 'rootTest',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['Sub.One', 'Sub.Two'],
      }),
    );

    const provider = new TiTestTreeProvider(() => tmp);
    await provider.refresh();
    const item = provider.findItemByFolder(testDir);
    const children = await provider.getChildren(item);
    const subs = children?.filter((c) => c.node.kind === 'sub') ?? [];
    expect(subs.map((s) => s.label).sort()).toEqual(['Sub.One', 'Sub.Two']);
    for (const s of subs) {
      expect(s.node.manifest && 'kind' in s.node.manifest && s.node.manifest.kind).toBe('ti-test-sub');
    }
  });

  it('test with no subs/ dir has no sub children', async () => {
    const testDir = path.join(tmp, 'plain', 'test1');
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 'test1',
        process: 'test1',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
      }),
    );

    const provider = new TiTestTreeProvider(() => tmp);
    await provider.refresh();
    const item = provider.findItemByFolder(testDir);
    expect(item).toBeDefined();
    const children = await provider.getChildren(item);
    expect(children?.filter((c) => c.node.kind === 'sub')).toHaveLength(0);
  });

  it('marks root test failed if any sub failed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'titt-agg-'));
    const testDir = path.join(root, 'demo', 't1');
    await fs.mkdir(path.join(testDir, 'subs', 'Sub.A', 'data'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'subs', 'Sub.B', 'data'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'manifest.json'), JSON.stringify({
      version: 2, kind: 'ti-test', name: 't1', process: 't1', active: true, schemaVersion: 2,
      datasourceType: 'None', writeTargets: { cubes: [], dimensions: [] }, subs: ['Sub.A', 'Sub.B'],
    }));
    for (const s of ['Sub.A', 'Sub.B']) {
      await fs.writeFile(path.join(testDir, 'subs', s, 'manifest.json'), JSON.stringify({
        version: 2, kind: 'ti-test-sub', name: s, parent: '../..', rootTest: 't1',
        clonedFrom: s, parameters: [], callContext: { callerProcess: 't1', callerLine: 1, callIndex: 0 }, active: true,
      }));
    }

    // Drop .last-run.json files: root=pass, Sub.A=fail, Sub.B=pass
    const write = (folder: string, result: 'pass' | 'fail') =>
      fs.writeFile(path.join(folder, '.last-run.json'), JSON.stringify({ result, at: new Date().toISOString() }));
    await write(testDir, 'pass');
    await write(path.join(testDir, 'subs', 'Sub.A'), 'fail');
    await write(path.join(testDir, 'subs', 'Sub.B'), 'pass');

    const provider = new TiTestTreeProvider(() => root);
    await provider.refresh();
    expect(provider.aggregatedStatus(testDir)).toBe('fail');
  });

  it('marks root test passed when own + all subs passed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'titt-aggp-'));
    const testDir = path.join(root, 'demo', 't2');
    await fs.mkdir(path.join(testDir, 'subs', 'Sub.A', 'data'), { recursive: true });
    await fs.writeFile(path.join(testDir, 'manifest.json'), JSON.stringify({
      version: 2, kind: 'ti-test', name: 't2', process: 't2', active: true, schemaVersion: 2,
      datasourceType: 'None', writeTargets: { cubes: [], dimensions: [] }, subs: ['Sub.A'],
    }));
    await fs.writeFile(path.join(testDir, 'subs', 'Sub.A', 'manifest.json'), JSON.stringify({
      version: 2, kind: 'ti-test-sub', name: 'Sub.A', parent: '../..', rootTest: 't2',
      clonedFrom: 'Sub.A', parameters: [],
      callContext: { callerProcess: 't2', callerLine: 1, callIndex: 0 }, active: true,
    }));
    const write = (folder: string) =>
      fs.writeFile(path.join(folder, '.last-run.json'), JSON.stringify({ result: 'pass', at: new Date().toISOString() }));
    await write(testDir);
    await write(path.join(testDir, 'subs', 'Sub.A'));

    const provider = new TiTestTreeProvider(() => root);
    await provider.refresh();
    expect(provider.aggregatedStatus(testDir)).toBe('pass');
  });

  it('folders without ti-test-sub kind are ignored in subs/', async () => {
    const testDir = path.join(tmp, 'filtered', 'test1');
    await fs.mkdir(path.join(testDir, 'subs', 'BadSub'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 'test1',
        process: 'test1',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
      }),
    );
    // Write a manifest with wrong kind — should be skipped
    await fs.writeFile(
      path.join(testDir, 'subs', 'BadSub', 'manifest.json'),
      JSON.stringify({
        version: 2,
        kind: 'ti-test',
        name: 'BadSub',
        process: 'BadSub',
        active: true,
        schemaVersion: 2,
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
      }),
    );

    const provider = new TiTestTreeProvider(() => tmp);
    await provider.refresh();
    const item = provider.findItemByFolder(testDir);
    const children = await provider.getChildren(item);
    expect(children?.filter((c) => c.node.kind === 'sub')).toHaveLength(0);
  });
});
