// The "Recent" list: cap, deduplication and the `x` on the row.
//
// The cap was at 5 from the start and was raised to 15 on 2026-08-26
// (decision by flameY3T1) — anyone working on several processes at once
// pushed the older ones out themselves with only 5 slots.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('vscode', async () => await import('./__mocks__/vscode'));
vi.mock('../providers/tm1TreeNodes', () => ({ iconPath: () => undefined }));
vi.mock('../runState/runRegistry', () => ({
  listRuns: () => [],
  onDidChangeRuns: () => ({ dispose: () => {} }),
}));
vi.mock('../runState/runningTreeProvider', () => ({ formatElapsed: () => '0s' }));

import { RecentTreeProvider, type RecentItem } from '../recentTreeProvider';

/** An ExtensionContext whose `globalState` lives in memory. */
function fakeContext() {
  const store: Record<string, unknown> = {};
  return {
    extensionUri: {} as never,
    globalState: {
      get: <T>(key: string, def?: T): T => (store[key] as T) ?? (def as T),
      update: async (key: string, val: unknown): Promise<void> => { store[key] = val; },
    },
  } as never;
}

function eintrag(name: string, kind: RecentItem['kind'] = 'process') {
  return { kind, serverId: 'srv1', serverName: 'Server 1', name };
}

describe('RecentTreeProvider', () => {
  let p: RecentTreeProvider;

  beforeEach(() => { p = new RecentTreeProvider(fakeContext()); });

  it('holds 15 entries instead of 5', async () => {
    for (let i = 1; i <= 20; i++) { await p.addRecent(eintrag('P' + i)); }
    const namen = p.getItems().map(x => x.name);
    expect(namen).toHaveLength(15);
    // Newest first, the six oldest have dropped out.
    expect(namen[0]).toBe('P20');
    expect(namen.at(-1)).toBe('P6');
    expect(namen).not.toContain('P5');
  });

  it('moves a re-open to the top instead of duplicating', async () => {
    await p.addRecent(eintrag('A'));
    await p.addRecent(eintrag('B'));
    await p.addRecent(eintrag('A'));
    expect(p.getItems().map(x => x.name)).toEqual(['A', 'B']);
  });

  it('separates identical names by kind and server', async () => {
    await p.addRecent(eintrag('X', 'process'));
    await p.addRecent(eintrag('X', 'rule'));
    await p.addRecent({ kind: 'process', serverId: 'srv2', name: 'X' });
    expect(p.getItems()).toHaveLength(3);
  });

  it('removes exactly one entry with `remove`', async () => {
    await p.addRecent(eintrag('A'));
    await p.addRecent(eintrag('B'));
    await p.addRecent(eintrag('C'));
    await p.remove({ kind: 'process', serverId: 'srv1', name: 'B' });
    expect(p.getItems().map(x => x.name)).toEqual(['C', 'A']);
  });

  it('`remove` compares by key, not by object identity', async () => {
    // The value VS Code passes to the command does not survive a reload of the
    // view — a freshly built object with the same fields must
    // hit the same entry.
    await p.addRecent(eintrag('A'));
    await p.remove({ kind: 'process', serverId: 'srv1', name: 'A' });
    expect(p.getItems()).toHaveLength(0);
  });

  it('`remove` leaves another kind with the same name in place', async () => {
    await p.addRecent(eintrag('X', 'process'));
    await p.addRecent(eintrag('X', 'rule'));
    await p.remove({ kind: 'rule', serverId: 'srv1', name: 'X' });
    expect(p.getItems().map(x => x.kind)).toEqual(['process']);
  });

  it('sets a contextValue on the entry that the `x` hangs on', () => {
    const ti = p.getTreeItem(eintrag('A') as RecentItem);
    // The menu in package.json binds via `viewItem =~ /^recent\./`.
    expect(String(ti.contextValue)).toMatch(/^recent\./);
  });
});

// ── The wiring of the `x` lives in package.json, not in the code ────────────
//
// A button that only the menu contributions make visible otherwise disappears
// unnoticed: the command would stay registered, but the row would have no `x`.
describe('package.json — the `x` on the row', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('knows the command with an X icon', () => {
    const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === 'tm1.recent.remove');
    expect(cmd).toBeTruthy();
    expect(cmd.icon).toBe('$(close)');
  });

  it('attaches it inline to the entries of the view', () => {
    const m = pkg.contributes.menus['view/item/context']
      .find((x: { command: string }) => x.command === 'tm1.recent.remove');
    expect(m).toBeTruthy();
    expect(m.when).toContain('view == tm1.recent');
    // Only on entries, NOT on a running execution (`tm1.run`).
    expect(m.when).toContain('viewItem =~ /^recent\\./');
    expect(String(m.group)).toMatch(/^inline/);
  });

  it('keeps it out of the command palette', () => {
    const m = pkg.contributes.menus.commandPalette
      .find((x: { command: string }) => x.command === 'tm1.recent.remove');
    expect(m?.when).toBe('false');
  });

  it('has the title in BOTH bundles', () => {
    for (const f of ['package.nls.json', 'package.nls.de.json']) {
      const nls = JSON.parse(readFileSync(f, 'utf8'));
      expect(nls['tm1.recent.remove.title'], f).toBeTruthy();
    }
  });
});

// ── The context menu on a process entry ─────────────────────────────────────
//
// "Execute", "Delete" and "Call graph" are the Explorer's commands,
// unchanged. They read `nodeType` and `meta.{processName,serverId}` — so the
// list entry is given these fields in `getChildren`.
// If that is dropped, all three return without a word.
describe('Pinning (favorites)', () => {
  let p: RecentTreeProvider;
  beforeEach(() => { p = new RecentTreeProvider(fakeContext()); });
  const namen = () => p.getItems().map(x => x.name);

  it('puts pinned entries at the top, in the order they were pinned', async () => {
    for (const n of ['A', 'B', 'C']) { await p.addRecent(eintrag(n)); }
    await p.setPinned(eintrag('A'), true);
    await p.setPinned(eintrag('B'), true);
    expect(namen()).toEqual(['A', 'B', 'C']);
    // Re-opening does not move a favorite.
    await p.addRecent(eintrag('B'));
    expect(namen()).toEqual(['A', 'B', 'C']);
    expect(p.getItems()[1].pinned).toBe(true);
  });

  it('does not count favorites against the cap of 15', async () => {
    await p.addRecent(eintrag('Fav'));
    await p.setPinned(eintrag('Fav'), true);
    for (let i = 1; i <= 20; i++) { await p.addRecent(eintrag('P' + i)); }
    expect(namen()[0]).toBe('Fav');
    expect(namen()).toHaveLength(16);
  });

  it('clearing leaves favorites in place, unpinning puts the entry at the top of the rest', async () => {
    for (const n of ['A', 'B']) { await p.addRecent(eintrag(n)); }
    await p.setPinned(eintrag('A'), true);
    await p.clear();
    expect(namen()).toEqual(['A']);
    await p.addRecent(eintrag('C'));
    await p.setPinned(eintrag('A'), false);
    expect(namen()).toEqual(['A', 'C']);
    expect(p.getItems()[0].pinned).toBeUndefined();
  });

  it('marks the favorite in the contextValue so that pin/unpin switch', async () => {
    await p.addRecent(eintrag('A'));
    expect(p.getTreeItem(p.getItems()[0]).contextValue).toBe('recent.process');
    await p.setPinned(eintrag('A'), true);
    expect(p.getTreeItem(p.getItems()[0]).contextValue).toBe('recent.process.pinned');
    await p.setPinned(eintrag('A'), false);
    expect(p.getTreeItem(p.getItems()[0]).contextValue).toBe('recent.process');
  });

  it('splits into Favorites and Recent as long as there are favorites', async () => {
    const namen = (n: unknown[]) => n.map(x => (x as RecentItem).name);
    await p.addRecent(eintrag('A'));
    await p.addRecent(eintrag('B'));
    expect(namen(p.getChildren())).toEqual(['B', 'A']);

    await p.setPinned(eintrag('A'), true);
    const [fav, rest] = p.getChildren();
    expect(p.getChildren()).toHaveLength(2);
    expect(namen(p.getChildren(fav))).toEqual(['A']);
    expect(namen(p.getChildren(rest))).toEqual(['B']);
    expect(p.getParent(p.getChildren(fav)[0])).toBe(fav);

    // Everything pinned: no empty "Recent" group.
    await p.setPinned(eintrag('B'), true);
    expect(p.getChildren()).toHaveLength(1);

    // No favorite left: flat again.
    await p.setPinned(eintrag('A'), false);
    await p.setPinned(eintrag('B'), false);
    expect(namen(p.getChildren())).toEqual(['B', 'A']);
    expect(p.getParent(p.getChildren()[0])).toBeUndefined();
  });
});

describe('Context menu on a process entry', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const items = pkg.contributes.menus['view/item/context'] as Array<{ command: string; when?: string }>;

  it.each([
    ['tm1.executeProcessFromTree'],
    ['tm1.runProcessCoverage'],
    ['tm1.deleteProcess'],
    ['tm1.processTemplate.saveFromProcess'],
    ['tm1.newProcess'],
    ['tm1.deployProcessToServer'],
    ['tm1.findReferences'],
    ['tm1.insertNodeRef'],
    ['tm1.tiTest.captureProcess'],
  ])('%s is attached to the contextValue recent.process[.pinned]', (cmd) => {
    const m = items.find(x => x.command === cmd && (x.when ?? '').includes('tm1.recent'));
    expect(m, cmd).toBeTruthy();
    // Regex instead of equality: a pinned process is called `recent.process.pinned`.
    expect(m!.when).toBe('view == tm1.recent && viewItem =~ /^recent\\.process/');
  });

  it.each([
    ['tm1.recent.open'],
    ['tm1.copyName'],
  ])('%s is attached to process AND rule entries', (cmd) => {
    const m = items.find(x => x.command === cmd && (x.when ?? '').includes('tm1.recent'));
    expect(m, cmd).toBeTruthy();
    expect(m!.when).toBe('view == tm1.recent && viewItem =~ /^recent\\.(process|rule)/');
  });

  it('tm1.deployToServer is attached to the rule entry', () => {
    const m = items.find(x => x.command === 'tm1.deployToServer' && (x.when ?? '').includes('tm1.recent'));
    expect(m!.when).toBe('view == tm1.recent && viewItem =~ /^recent\\.rule/');
  });

  it('hands out process entries as tree nodes', async () => {
    const p2 = new RecentTreeProvider(fakeContext());
    await p2.addRecent(eintrag('Zu.Loeschen'));
    const knoten = p2.getChildren()[0] as unknown as {
      nodeType?: string; meta?: { processName?: string; serverId?: string };
    };
    expect(knoten.nodeType).toBe('process');
    expect(knoten.meta).toEqual({ processName: 'Zu.Loeschen', serverId: 'srv1' });
  });

  it('hands out rule entries as cubeRule nodes', async () => {
    const p2 = new RecentTreeProvider(fakeContext());
    await p2.addRecent(eintrag('Cube1', 'rule'));
    const knoten = p2.getChildren()[0] as unknown as {
      nodeType?: string; meta?: { cubeName?: string; serverId?: string };
    };
    expect(knoten.nodeType).toBe('cubeRule');
    expect(knoten.meta).toEqual({ cubeName: 'Cube1', serverId: 'srv1' });
  });

  it('leaves thread entries untouched', async () => {
    const p2 = new RecentTreeProvider(fakeContext());
    await p2.addRecent(eintrag('srv1', 'threads'));
    const knoten = p2.getChildren()[0] as unknown as { nodeType?: string; meta?: unknown };
    expect(knoten.nodeType).toBeUndefined();
    expect(knoten.meta).toBeUndefined();
  });
});
