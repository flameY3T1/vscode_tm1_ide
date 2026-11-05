import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  discoverTests,
  buildTreeFromDiscovery,
  collectTests,
} from '../../../tiTestFramework/discovery/testDiscovery';
import { writeManifest, type Manifest } from '../../../tiTestFramework/storage/manifestIo';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

const sampleManifest = (name: string): Manifest => ({
  schemaVersion: 1,
  name,
  process: 'CopyActuals',
  active: true,
  captured: { at: '2026-05-09T10:30:00Z', server: 'prod', extensionVersion: '1.23.0' },
  datasourceType: 'None',
  writeTargets: { cubes: ['Plan'], dimensions: [] },
});

async function makeTest(rel: string, name: string): Promise<void> {
  const folder = path.join(tmp, rel);
  await writeManifest(folder, sampleManifest(name));
  await fs.mkdir(path.join(folder, 'input'), { recursive: true });
  await fs.mkdir(path.join(folder, 'expected'), { recursive: true });
}

describe('discoverTests', () => {
  it('returns empty result for missing root', async () => {
    const r = await discoverTests(path.join(tmp, 'missing'));
    expect(r.entries).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('returns empty result for empty root', async () => {
    const r = await discoverTests(tmp);
    expect(r.entries).toEqual([]);
  });

  it('finds a single top-level test', async () => {
    await makeTest('Smoke/copyActuals_jan', 'copyActuals_jan');
    const r = await discoverTests(tmp);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].relativePath).toBe('Smoke/copyActuals_jan');
    expect(r.entries[0].manifest.name).toBe('copyActuals_jan');
  });

  it('finds tests at multiple nesting depths', async () => {
    await makeTest('A/Smoke/t1', 't1');
    await makeTest('A/Smoke/t2', 't2');
    await makeTest('A/Regression/t3', 't3');
    await makeTest('B/t4', 't4');
    const r = await discoverTests(tmp);
    expect(r.entries.map((e) => e.relativePath)).toEqual([
      'A/Regression/t3',
      'A/Smoke/t1',
      'A/Smoke/t2',
      'B/t4',
    ]);
  });

  it('does NOT recurse into a test folder (input/expected are not searched)', async () => {
    await makeTest('A/t1', 't1');
    const nested = path.join(tmp, 'A/t1/expected/nested');
    await writeManifest(nested, sampleManifest('nested'));
    const r = await discoverTests(tmp);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].relativePath).toBe('A/t1');
  });

  it('skips node_modules + dotfile dirs', async () => {
    await makeTest('A/t1', 't1');
    await writeManifest(path.join(tmp, 'node_modules/junk'), sampleManifest('junk'));
    await writeManifest(path.join(tmp, '.cache/junk'), sampleManifest('junk'));
    const r = await discoverTests(tmp);
    expect(r.entries.map((e) => e.relativePath)).toEqual(['A/t1']);
  });

  it('reports manifest validation errors as warnings, not crashes', async () => {
    await fs.mkdir(path.join(tmp, 'A/broken'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'A/broken/manifest.json'), '{ not json');
    await makeTest('A/good', 'good');
    const r = await discoverTests(tmp);
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].folder).toContain(`A${path.sep}broken`);
  });
});

describe('buildTreeFromDiscovery', () => {
  it('builds folder hierarchy from flat entries', async () => {
    await makeTest('A/Smoke/t1', 't1');
    await makeTest('A/Smoke/t2', 't2');
    await makeTest('A/Regression/t3', 't3');
    await makeTest('B/t4', 't4');
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries);

    expect(tree.kind).toBe('folder');
    expect(tree.children.map((c) => c.label)).toEqual(['A', 'B']);

    const a = tree.children.find((c) => c.label === 'A')!;
    expect(a.children.map((c) => c.label)).toEqual(['Regression', 'Smoke']);

    const smoke = a.children.find((c) => c.label === 'Smoke')!;
    expect(smoke.children.map((c) => c.label)).toEqual(['t1', 't2']);
    expect(smoke.children[0].kind).toBe('test');
  });

  it('sorts folders before tests at the same level', async () => {
    await makeTest('z_test', 'z_test');
    await makeTest('a_folder/t1', 't1');
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries);
    expect(tree.children.map((c) => c.label)).toEqual(['a_folder', 'z_test']);
    expect(tree.children[0].kind).toBe('folder');
    expect(tree.children[1].kind).toBe('test');
  });

  it('returns empty tree for empty entries', () => {
    const tree = buildTreeFromDiscovery(tmp, []);
    expect(tree.children).toEqual([]);
  });
});

describe('collectTests', () => {
  it('flattens all test leaves under a folder', async () => {
    await makeTest('A/t1', 't1');
    await makeTest('A/t2', 't2');
    await makeTest('B/t3', 't3');
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries);
    const a = tree.children.find((c) => c.label === 'A')!;
    expect(collectTests(a).map((e) => e.manifest.name)).toEqual(['t1', 't2']);
  });

  it('returns single test when called on a leaf node', async () => {
    await makeTest('A/t1', 't1');
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries);
    const t1 = tree.children[0].children[0];
    expect(collectTests(t1)).toHaveLength(1);
  });

  it('returns empty for folder without tests', async () => {
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries);
    expect(collectTests(tree)).toEqual([]);
  });
});

describe('discoverTests — emptyFolders', () => {
  it('reports empty container folders', async () => {
    await fs.mkdir(path.join(tmp, 'EmptyA'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'EmptyB'), { recursive: true });
    await makeTest('Smoke/t1', 't1');
    const r = await discoverTests(tmp);
    expect(r.emptyFolders).toContain('EmptyA');
    expect(r.emptyFolders).toContain('EmptyB');
    expect(r.emptyFolders).not.toContain('Smoke');
  });

  it('does NOT mark ancestor of test as empty', async () => {
    await makeTest('A/B/t1', 't1');
    const r = await discoverTests(tmp);
    expect(r.emptyFolders).not.toContain('A');
    expect(r.emptyFolders).not.toContain('A/B');
  });

  it('marks empty leaf inside ancestor that has tests', async () => {
    await makeTest('A/Live/t1', 't1');
    await fs.mkdir(path.join(tmp, 'A/Empty'), { recursive: true });
    const r = await discoverTests(tmp);
    expect(r.emptyFolders).toContain('A/Empty');
    expect(r.emptyFolders).not.toContain('A');
    expect(r.emptyFolders).not.toContain('A/Live');
  });

  it('returns empty result fields for missing root', async () => {
    const r = await discoverTests(path.join(tmp, 'missing'));
    expect(r.entries).toEqual([]);
    expect(r.emptyFolders).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('buildTreeFromDiscovery — emptyFolders', () => {
  it('renders folder node for empty container', async () => {
    await fs.mkdir(path.join(tmp, 'NewEmpty'), { recursive: true });
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries, r.emptyFolders);
    const node = tree.children.find((c) => c.label === 'NewEmpty');
    expect(node).toBeDefined();
    expect(node!.kind).toBe('folder');
    expect(node!.children).toEqual([]);
  });

  it('does not duplicate folder when ancestor already has tests', async () => {
    await makeTest('A/t1', 't1');
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries, ['A']);
    const matches = tree.children.filter((c) => c.label === 'A');
    expect(matches).toHaveLength(1);
  });

  it('renders nested empty folder hierarchy', async () => {
    await fs.mkdir(path.join(tmp, 'X/Y/Z'), { recursive: true });
    const r = await discoverTests(tmp);
    const tree = buildTreeFromDiscovery(tmp, r.entries, r.emptyFolders);
    const x = tree.children.find((c) => c.label === 'X')!;
    expect(x).toBeDefined();
    const y = x.children.find((c) => c.label === 'Y')!;
    expect(y).toBeDefined();
    const z = y.children.find((c) => c.label === 'Z')!;
    expect(z).toBeDefined();
    expect(z.kind).toBe('folder');
  });
});
