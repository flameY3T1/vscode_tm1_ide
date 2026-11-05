import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TiTestTreeProvider, TiTestTreeItem, formatGermanDateTime } from '../../views/tiTestTreeProvider';
import { writeManifest, type Manifest } from '../../tiTestFramework/storage/manifestIo';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-tree-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

const sampleManifest = (name: string, active = true): Manifest => ({
  schemaVersion: 1,
  name,
  process: 'CopyActuals',
  active,
  captured: { at: '2026-05-09T10:30:00Z', server: 'prod', extensionVersion: '1.23.0' },
  datasourceType: 'None',
  writeTargets: { cubes: ['Plan'], dimensions: [] },
});

async function makeTest(rel: string, name: string, active = true): Promise<string> {
  const folder = path.join(tmp, rel);
  await writeManifest(folder, sampleManifest(name, active));
  return folder;
}

describe('TiTestTreeProvider', () => {
  it('returns empty children when root folder is undefined', async () => {
    const p = new TiTestTreeProvider(() => undefined);
    expect(await p.getChildren()).toEqual([]);
  });

  it('returns folder + test items at root level', async () => {
    await makeTest('Smoke/t1', 't1');
    await makeTest('Smoke/t2', 't2');
    await makeTest('Regression/t3', 't3');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    expect(root.map((i) => i.label)).toEqual(['Regression', 'Smoke']);
    expect(root[0].contextValue).toBe('tiTestFolder');
  });

  it('descends into folder children', async () => {
    await makeTest('Smoke/t1', 't1');
    await makeTest('Smoke/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const smoke = root.find((i) => i.label === 'Smoke')!;
    const tests = await p.getChildren(smoke);
    expect(tests.map((i) => i.label)).toEqual(['t1', 't2']);
    expect(tests[0].contextValue).toBe('tiTest.active');
  });

  it('marks disabled tests with disabled context + icon', async () => {
    await makeTest('A/t1', 't1', false);
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    const tests = await p.getChildren(a);
    expect(tests[0].contextValue).toBe('tiTest.disabled');
  });

  it('reflects last-run pass status on the test item', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(folder, true);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    const tests = await p.getChildren(a);
    expect(tests[0].description).toMatch(/^pass · \d{2}:\d{2}$/);
  });

  it('reflects last-run fail status', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(folder, false);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    expect(tests[0].description).toMatch(/^fail · \d{2}:\d{2}$/);
  });

  it('reflects running flag and clears on updateLastRun', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.markRunning(folder);
    let tests = await p.getChildren((await p.getChildren())[0]);
    expect(tests[0].description).toBe('running…');
    p.updateLastRun(folder, true);
    tests = await p.getChildren((await p.getChildren())[0]);
    expect(tests[0].description).toMatch(/^pass · \d{2}:\d{2}$/);
  });

  it('refresh() forces a re-discovery', async () => {
    await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    let root = await p.getChildren();
    expect(root).toHaveLength(1);

    await makeTest('B/t2', 't2');
    p.refresh();
    root = await p.getChildren();
    expect(root.map((i) => i.label)).toEqual(['A', 'B']);
  });

  it('collectTestsBelow returns all leaves under a folder', async () => {
    await makeTest('A/t1', 't1');
    await makeTest('A/t2', 't2');
    await makeTest('B/t3', 't3');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    const tests = p.collectTestsBelow(a);
    expect(tests.map((t) => t.manifest.name)).toEqual(['t1', 't2']);
  });

  it('collectTestsBelow with undefined returns all root tests', async () => {
    await makeTest('A/t1', 't1');
    await makeTest('B/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    expect(p.collectTestsBelow().map((t) => t.manifest.name)).toEqual(['t1', 't2']);
  });

  it('findNode locates a test folder by absolute path', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    const node = p.findNode(folder);
    expect(node?.kind).toBe('test');
    expect(node?.manifest?.name).toBe('t1');
  });

  it('test item carries showLastDiff command', async () => {
    await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    expect(tests[0].command?.command).toBe('tm1.tiTest.showLastDiff');
  });

  it('clearLastRun removes status', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(folder, true);
    p.clearLastRun(folder);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    expect(tests[0].description).toBeUndefined();
  });
});

describe('TiTestTreeProvider — folder status aggregation', () => {
  it('folder with all-pass tests reports pass', async () => {
    const t1 = await makeTest('A/t1', 't1');
    const t2 = await makeTest('A/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(t1, true);
    p.updateLastRun(t2, true);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect(a.iconPath).toBeDefined();
    expect((a.iconPath as any).color?.id).toBe('testing.iconPassed');
  });

  it('folder with any failing test reports fail', async () => {
    const t1 = await makeTest('A/t1', 't1');
    const t2 = await makeTest('A/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(t1, true);
    p.updateLastRun(t2, false);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect((a.iconPath as any).color?.id).toBe('testing.iconFailed');
  });

  it('folder with running test does not get pass/fail color', async () => {
    const t1 = await makeTest('A/t1', 't1');
    await makeTest('A/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.markRunning(t1);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    const colorId = (a.iconPath as any).color?.id;
    expect(colorId).not.toBe('testing.iconPassed');
    expect(colorId).not.toBe('testing.iconFailed');
  });

  it('folder with mix pass + notRun stays notRun (no green)', async () => {
    const t1 = await makeTest('A/t1', 't1');
    await makeTest('A/t2', 't2');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(t1, true);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect((a.iconPath as any).color).toBeUndefined();
  });

  it('disabled tests are excluded from aggregation', async () => {
    const t1 = await makeTest('A/t1', 't1', true);
    const t2 = await makeTest('A/t2', 't2', false);
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(t1, true);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect((a.iconPath as any).color?.id).toBe('testing.iconPassed');
    void t2;
  });

  it('empty folder reports notRun', async () => {
    await fs.mkdir(path.join(tmp, 'EmptyDir'), { recursive: true });
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const empty = root.find((i) => i.label === 'EmptyDir')!;
    expect(empty).toBeDefined();
    expect((empty.iconPath as any).color).toBeUndefined();
  });

  it('aggregation walks nested folders', async () => {
    const t1 = await makeTest('A/Sub/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(t1, false);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect((a.iconPath as any).color?.id).toBe('testing.iconFailed');
  });
});

describe('formatGermanDateTime', () => {
  it('formats ISO string as DD.MM.YYYY HH:mm', () => {
    const out = formatGermanDateTime('2026-05-09T10:30:00Z');
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  });

  it('formats ms timestamp', () => {
    const out = formatGermanDateTime(new Date(2026, 4, 9, 14, 5).getTime());
    expect(out).toBe('09.05.2026 14:05');
  });

  it('returns undefined for invalid input', () => {
    expect(formatGermanDateTime('not-a-date')).toBeUndefined();
    expect(formatGermanDateTime(undefined)).toBeUndefined();
  });
});

describe('TiTestTreeProvider — counts + lastRun extras', () => {
  it('folder description shows total tests', async () => {
    await makeTest('A/t1', 't1');
    await makeTest('A/t2', 't2');
    await makeTest('A/t3', 't3');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect(a.description).toBe('3 Tests');
  });

  it('folder description shows active/total when some disabled', async () => {
    await makeTest('A/t1', 't1', true);
    await makeTest('A/t2', 't2', false);
    await makeTest('A/t3', 't3', true);
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const a = root.find((i) => i.label === 'A')!;
    expect(a.description).toBe('2/3 Tests');
  });

  it('empty folder has no description', async () => {
    await fs.mkdir(path.join(tmp, 'Empty'), { recursive: true });
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const empty = root.find((i) => i.label === 'Empty')!;
    expect(empty.description).toBeUndefined();
  });

  it('test description includes time after run', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(folder, true);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    expect(tests[0].description).toMatch(/^pass · \d{2}:\d{2}$/);
  });

  // The labels have been English since B16 and go through `l10n.t`; the
  // date format stays German for now (Codex finding C24, separate pass).
  it('test tooltip uses German date format for captured + lastRun', async () => {
    const folder = await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    await p.getChildren();
    p.updateLastRun(folder, true);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    const tip = String(tests[0].tooltip);
    expect(tip).toContain('Captured:');
    expect(tip).toMatch(/Captured: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
    expect(tip).toContain('Last run:');
    expect(tip).toMatch(/Last run: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
  });
});

describe('TiTestTreeItem', () => {
  it('folder item is collapsible', async () => {
    await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    expect(root[0]).toBeInstanceOf(TiTestTreeItem);
    expect(root[0].collapsibleState).not.toBe(0);
  });

  it('test item is not collapsible', async () => {
    await makeTest('A/t1', 't1');
    const p = new TiTestTreeProvider(() => tmp);
    const root = await p.getChildren();
    const tests = await p.getChildren(root[0]);
    expect(tests[0].collapsibleState).toBe(0);
  });
});
