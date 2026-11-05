import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';
import {
  initServerManager,
  setProcessGroupOverride,
  clearProcessGroupOverride,
} from '../commands/serverManager';
import { DYNAMIC_SUBSET_MARK } from '../utils/dynamicSubsetMark';
import { TreeItemCollapsibleState, workspace } from './__mocks__/vscode';

// Mock apiRequest
vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: (res: { statusCode: number; body: string }, context?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = context ? `${context}: ` : '';
      let detail = res.body.substring(0, 300);
      try {
        const parsed = JSON.parse(res.body);
        const msg = parsed?.error?.message;
        detail = (typeof msg === 'object' ? msg?.value : msg) ?? detail;
      } catch { /* keep raw */ }
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${detail}`);
    }
  },
}));

// The cube list also asks the performance monitor for load states — its own
// request, which would eat the `mockResolvedValueOnce` sequences below.
vi.mock('../tm1Rest/runStatsApi', () => ({ fetchCubeLoadStates: async () => new Map() }));

import { apiRequest } from '../tm1Rest/client';
const mockApiRequest = vi.mocked(apiRequest);

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SERVER = {
  id: 'test-srv',
  name: 'Test Server',
  serverUrl: 'http://localhost:8010',
  username: 'admin',
  rejectUnauthorized: false,
  authType: 'Basic' as const,
};
const TEST_CONFIG = {
  serverUrl: 'http://localhost:8010',
  username: 'admin',
  password: '',
  rejectUnauthorized: false,
  authType: 'Basic' as const,
};

/** Create a provider with zero or one test server. */
function makeProvider(connected = true) {
  const servers = connected ? [TEST_SERVER] : [];
  return new Tm1TreeDataProvider(
    () => servers,
    (id) => connected && id === TEST_SERVER.id,
    (id) => (connected && id === TEST_SERVER.id ? TEST_CONFIG : undefined),
  );
}

/** Navigate to the serverRoot node (index 0 in root children). */
async function getServerRoot(provider: Tm1TreeDataProvider) {
  const roots = await provider.getChildren(undefined);
  return roots[0]; // serverRoot is always first, snippetsRoot is last
}

/** Navigate to the category array of the connected test server. */
async function getCategories(provider: Tm1TreeDataProvider) {
  const serverRoot = await getServerRoot(provider);
  return provider.getChildren(serverRoot);
}

// `isSandboxEnabled` (sandboxApi) queries `ActiveConfiguration` ONCE per serverUrl
// and remembers the result module-globally. Until now the fetch was paid for by the test that
// expanded the categories first — with a fixed file order always
// the same one, with a random order any one, which then lacks a `mockResolvedValueOnce`
// and whose actual fetch gets `undefined`. Warm it up once
// (the answer does not matter, the error path remembers `true`), then the cache is
// set for every test. All test servers share `serverUrl`.
beforeAll(async () => {
  await getCategories(makeProvider());
  mockApiRequest.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Tm1TreeDataProvider', () => {
  // `resetAllMocks` instead of `clearAllMocks`: `clear` leaves unconsumed
  // `mockResolvedValueOnce` queues and set return values in place, which then
  // leak into the next test.
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getTreeItem', () => {
    it('returns the element itself', async () => {
      const provider = makeProvider();
      const children = await provider.getChildren(undefined);
      const item = provider.getTreeItem(children[0]);
      expect(item).toBe(children[0]);
    });
  });

  // ── Root level ──────────────────────────────────────────────────────────────

  describe('getChildren(undefined) — no servers configured', () => {
    it('returns an empty tree so the viewsWelcome onboarding content renders', async () => {
      const provider = makeProvider(false); // empty server list
      const children = await provider.getChildren(undefined);

      expect(children).toEqual([]);
    });
  });

  describe('getChildren(undefined) — one server configured', () => {
    it('returns serverRoot node + snippets root + processTemplatesRoot', async () => {
      const provider = makeProvider(true);
      const children = await provider.getChildren(undefined);

      expect(children).toHaveLength(3);
      expect(children[0].nodeType).toBe('serverRoot');
      expect(children[0].label).toBe('Test Server');
      expect(children[1].nodeType).toBe('snippetsRoot');
      expect(children[2].nodeType).toBe('processTemplatesRoot');
    });

    it('connected server node is collapsible', async () => {
      const provider = makeProvider(true);
      const [serverRoot] = await provider.getChildren(undefined);
      expect(serverRoot.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(serverRoot.meta.connected).toBe(true);
    });

    it('disconnected server node is not collapsible', async () => {
      const provider = new Tm1TreeDataProvider(
        () => [TEST_SERVER],
        () => false,
        () => undefined,
      );
      const [serverRoot] = await provider.getChildren(undefined);
      expect(serverRoot.collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(serverRoot.meta.connected).toBe(false);
    });
  });

  // ── Server root → categories ────────────────────────────────────────────────

  describe('getChildren(serverRoot) — connected', () => {
    it('returns applicationsRoot + 5 categories + sandboxesRoot + messageLog + toolsRoot + workbenchesRoot = 10 children, Applications on top', async () => {
      const provider = makeProvider(true);
      const serverRoot = await getServerRoot(provider);
      const children = await provider.getChildren(serverRoot);

      expect(children.map(c => c.label)).toEqual(['Applications', 'Cubes', 'Dimensions', 'Processes', 'Chores', 'Sandboxes', 'Threads', 'Message Log', 'Tools', 'Workbenches']);
      expect(children[0].nodeType).toBe('applicationsRoot');
      expect(children[5].nodeType).toBe('sandboxesRoot');
      expect(children[7].nodeType).toBe('messageLog');
      expect(children[8].nodeType).toBe('toolsRoot');
      expect(children[9].nodeType).toBe('workbenchesRoot');
    });

    it('Tools holds the window tools; every leaf opens its command with the server id', async () => {
      const provider = makeProvider(true);
      const serverRoot = await getServerRoot(provider);
      const tools = (await provider.getChildren(serverRoot)).find(c => c.nodeType === 'toolsRoot')!;
      const items = await provider.getChildren(tools);
      expect(items.map(c => c.label)).toEqual(
        ['Transaction Log', 'MDX Runner', 'New TM1 Notebook', 'TI Console', 'Lineage', 'v12 Readiness Check', 'Find & Replace', 'Bulk Deploy', 'Bulk Delete']);
      const findReplace = await provider.getChildren(items.find(c => c.nodeType === 'findReplaceRoot')!);
      const leaves = [...items, ...findReplace].filter(c => c.nodeType !== 'findReplaceRoot');
      expect(leaves.map(c => c.command?.command)).toEqual([
        'tm1.showTransactionLog', 'tm1.mdx.open', 'tm1.notebook.new', 'tm1.tiConsole.open', 'tm1.showLineage',
        'tm1.v12ReadinessCheck', 'tm1.bulkDeploy.open', 'tm1.bulkDelete.open',
        'tm1.findReplaceObjects', 'tm1.openConsistencyNormalizer', 'tm1.openValueNaming',
      ]);
      for (const leaf of leaves) { expect(leaf.command?.arguments?.[0]?.meta.serverId).toBe(TEST_SERVER.id); }
    });

    it('all category nodes carry serverId in meta', async () => {
      const provider = makeProvider(true);
      const serverRoot = await getServerRoot(provider);
      const children = await provider.getChildren(serverRoot);

      for (const child of children) {
        expect(child.meta.serverId).toBe(TEST_SERVER.id);
      }
    });
  });

  describe('refreshCategory — targeted subtree refresh (P1)', () => {
    it('fires the exact cached category-node instance last returned from getChildren', async () => {
      const provider = makeProvider(true);
      const children = await getCategories(provider);
      const cubesCat = children.find(c => c.label === 'Cubes')!;

      const fired: unknown[] = [];
      provider.onDidChangeTreeData(n => fired.push(n));
      provider.refreshCategory(TEST_SERVER.id, 'Cubes');

      expect(fired).toHaveLength(1);
      expect(fired[0]).toBe(cubesCat); // same instance, not a fresh node
    });

    it('falls back to a global refresh (fire undefined) when the category was never built', () => {
      const provider = makeProvider(true);
      const fired: unknown[] = [];
      provider.onDidChangeTreeData(n => fired.push(n));
      provider.refreshCategory(TEST_SERVER.id, 'Cubes'); // cache empty — never expanded

      expect(fired).toEqual([undefined]);
    });

    it('falls back to global when serverId is undefined', () => {
      const provider = makeProvider(true);
      const fired: unknown[] = [];
      provider.onDidChangeTreeData(n => fired.push(n));
      provider.refreshCategory(undefined, 'Cubes');
      expect(fired).toEqual([undefined]);
    });

    it('clearCategoryCacheForServer drops the retained instance → next refreshCategory is global', async () => {
      const provider = makeProvider(true);
      await getCategories(provider); // populate cache
      provider.clearCategoryCacheForServer(TEST_SERVER.id);

      const fired: unknown[] = [];
      provider.onDidChangeTreeData(n => fired.push(n));
      provider.refreshCategory(TEST_SERVER.id, 'Cubes');
      expect(fired).toEqual([undefined]);
    });
  });

  describe('getChildren(serverRoot) — disconnected', () => {
    it('returns empty array for disconnected server', async () => {
      const provider = new Tm1TreeDataProvider(
        () => [TEST_SERVER],
        () => false,
        () => undefined,
      );
      const serverRoot = await getServerRoot(provider);
      const children = await provider.getChildren(serverRoot);
      expect(children).toHaveLength(0);
    });
  });

  // ── Categories ──────────────────────────────────────────────────────────────

  describe('getChildren(categoryNode) — Cubes', () => {
    it('returns cube nodes from API response', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }, { Name: 'Finance' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('cube');
      expect(children[0].label).toBe('Sales');
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(children[0].meta.cubeName).toBe('Sales');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[1].label).toBe('Finance');
    });
  });

  describe('getChildren(cubeNode) — Rules node visibility', () => {
    async function getCubeNode(provider: Tm1TreeDataProvider) {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      const cubesCat = (await getCategories(provider)).find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      return cubes[0];
    }

    it('shows the Rules node when the cube has rules', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      const children = await provider.getChildren(sales);
      expect(children[0].nodeType).toBe('cubeRule');
      expect(children.map((c) => c.label)).toContain('Rules');
    });

    it('hides the Rules node when the rules filter names no cube', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) });
      const children = await provider.getChildren(sales);
      expect(children.map((c) => c.nodeType)).not.toContain('cubeRule');
      expect(children[0].label).toBe('Dimensions');
    });

    it('keeps the Rules node reachable when the check errors (tolerant)', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockRejectedValueOnce(new Error('network down'));
      const children = await provider.getChildren(sales);
      expect(children[0].nodeType).toBe('cubeRule');
    });

    it('caches the has-rules probe: second expand does NOT re-fetch rules', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      expect((await provider.getChildren(sales))[0].nodeType).toBe('cubeRule');
      const callsAfterFirst = mockApiRequest.mock.calls.length;
      // Second expand is served from cache → zero further REST calls.
      const second = await provider.getChildren(sales);
      expect(second[0].nodeType).toBe('cubeRule');
      expect(mockApiRequest.mock.calls.length).toBe(callsAfterFirst);
    });

    it('re-fetches after invalidateCubeRulesCache (rule-save eviction)', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      expect((await provider.getChildren(sales))[0].nodeType).toBe('cubeRule');
      provider.invalidateCubeRulesCache(TEST_SERVER.id, 'Sales');
      mockApiRequest.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) });
      const after = await provider.getChildren(sales);
      expect(after.map((c) => c.nodeType)).not.toContain('cubeRule');
      expect(after[0].label).toBe('Dimensions');
    });

    it('clearCategoryCacheForServer evicts the has-rules cache too', async () => {
      const provider = makeProvider();
      const sales = await getCubeNode(provider);
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      expect((await provider.getChildren(sales))[0].nodeType).toBe('cubeRule');
      provider.clearCategoryCacheForServer(TEST_SERVER.id);
      mockApiRequest.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) });
      const after = await provider.getChildren(sales);
      expect(after.map((c) => c.nodeType)).not.toContain('cubeRule');
    });
  });

  describe('getChildren(categoryNode) — Dimensions', () => {
    it('returns dimension nodes from API response', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Region' }, { Name: 'Time' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const children = await provider.getChildren(dimCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('dimension');
      expect(children[0].label).toBe('Region');
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(children[0].meta.dimName).toBe('Region');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
    });
  });

  describe('getChildren(categoryNode) — Processes', () => {
    it('returns flat process nodes (sorted) when no name ends with the marker suffix', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'LoadData' }, { Name: 'ExportReport' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const procCat = categories.find((c) => c.label === 'Processes')!;
      const children = await provider.getChildren(procCat);

      expect(children).toHaveLength(2);
      expect(children.map(c => c.nodeType)).toEqual(['process', 'process']);
      expect(children.map(c => c.label)).toEqual(['ExportReport', 'LoadData']);
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(children[1].meta.processName).toBe('LoadData');
      expect(children[1].meta.serverId).toBe(TEST_SERVER.id);
    });

    it('groups processes by ##### marker and exposes children only when expanded', async () => {
      // Grouping only happens for a server that carries an override — there is
      // no default token, so this test has to configure one first.
      const store = new Map<string, unknown>([['tm1.servers', [TEST_SERVER]]]);
      initServerManager({
        globalState: {
          get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
          update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
        },
      } as any);
      await setProcessGroupOverride(TEST_SERVER.id, '#####', 'suffix');

      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          value: [
            { Name: '_Load_#####' },
            { Name: '_Load_Cube_A' },
            { Name: '_Load_Cube_B' },
            { Name: '_Save_#####' },
            { Name: '_Save_Daily' },
          ],
        }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const procCat = categories.find((c) => c.label === 'Processes')!;
      const groups = await provider.getChildren(procCat);

      expect(groups.map(g => g.nodeType)).toEqual(['processGroup', 'processGroup']);
      expect(groups.map(g => g.label)).toEqual(['_Load_#####', '_Save_#####']);
      expect(groups[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(groups[0].description).toBe('3');

      const loadChildren = await provider.getChildren(groups[0]);
      expect(loadChildren.map(c => c.label)).toEqual(['_Load_#####', '_Load_Cube_A', '_Load_Cube_B']);
      expect(loadChildren.every(c => c.nodeType === 'process')).toBe(true);
      expect(loadChildren[0].meta.serverId).toBe(TEST_SERVER.id);

      await clearProcessGroupOverride(TEST_SERVER.id); // don't leak into later tests
    });

    it('lists processes flat when the server carries no grouping override', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          value: [{ Name: '_Load_#####' }, { Name: '_Load_Cube_A' }, { Name: '_Save_#####' }],
        }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const procCat = categories.find((c) => c.label === 'Processes')!;
      const nodes = await provider.getChildren(procCat);

      // No default token: without an override nothing groups, not even names
      // that look like markers.
      expect(nodes.map(n => n.nodeType)).toEqual(['process', 'process', 'process']);
      expect(nodes.map(n => n.label)).toEqual(['_Load_#####', '_Load_Cube_A', '_Save_#####']);
    });
  });

  describe('getChildren(categoryNode) — Chores', () => {
    it('returns chore nodes with active status', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Nightly', Active: true }, { Name: 'Weekly', Active: false }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const choreCat = categories.find((c) => c.label === 'Chores')!;
      const children = await provider.getChildren(choreCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('chore');
      expect(children[0].label).toBe('Nightly');
      expect(children[0].meta.active).toBe(true);
      expect(children[0].description).toBe('Active');
      expect(children[1].meta.active).toBe(false);
      expect(children[1].description).toBe('Inactive');
    });
  });

  describe('getChildren(categoryNode) — Threads', () => {
    it('returns thread nodes and sets category description with count', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ ID: 1, State: 'Run', Name: 'admin' }, { ID: 2, State: 'Idle', Name: 'user1' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const threadCat = categories.find((c) => c.label === 'Threads')!;
      const children = await provider.getChildren(threadCat);

      // Only non-Idle threads shown (Run = 1 item)
      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('thread');
      expect(children[0].label).toBe('Thread 1');
      expect(children[0].meta.threadId).toBe(1);
      expect(children[0].meta.state).toBe('Run');
      expect(children[0].meta.user).toBe('admin');
      expect(threadCat.description).toBe('2 Threads');
    });
  });

  // ── Filter ──────────────────────────────────────────────────────────────────

  describe('getChildren(categoryNode) — filter', () => {
    it('applies case-insensitive filter on object names', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }, { Name: 'Finance' }, { Name: 'SalesTarget' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('sales');
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(2);
      expect(children[0].label).toBe('Sales');
      expect(children[1].label).toBe('SalesTarget');
    });
  });

  // ── Error handling (categories) ─────────────────────────────────────────────

  describe('getChildren(categoryNode) — error handling', () => {
    it('returns error node when API call fails', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Connection refused'));
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toBe('Connection refused');
    });

    it('returns error node with timeout message', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('TM1 Request Timeout (30s)'));
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toBe('Timeout — is the server reachable?');
    });

    it('returns error node on non-2xx HTTP status', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'Unauthorized' } }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toContain('HTTP 401');
    });
  });

  // ── refresh ─────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('fires onDidChangeTreeData event', () => {
      const provider = makeProvider(false);
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.refresh();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });

  describe('refreshNode()', () => {
    it('fires onDidChangeTreeData with the given node', async () => {
      const provider = makeProvider();
      const [serverRoot] = await provider.getChildren(undefined);
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.refreshNode(serverRoot);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(serverRoot);
    });
  });

  // ── error node parentNode ────────────────────────────────────────────────────

  describe('error node meta.parentNode for retry', () => {
    it('stores parentNode reference in error node meta', async () => {
      mockApiRequest.mockRejectedValueOnce(new Error('Connection refused'));
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].meta.parentNode).toBe(cubesCat);
    });
  });

  // ── setFilter ───────────────────────────────────────────────────────────────

  describe('setFilter()', () => {
    it('stores filter text and triggers refresh', () => {
      const provider = makeProvider(false);
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.setFilter('test');

      expect(provider.filterText).toBe('test');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('clears filter text when set to empty string', () => {
      const provider = makeProvider(false);
      provider.setFilter('something');
      provider.setFilter('');
      expect(provider.filterText).toBe('');
    });
  });

  // ── Filter across node types ─────────────────────────────────────────────────

  describe('filter — case-insensitive matching', () => {
    it('filter "SALES" matches "Sales", "sales", and "SalesTarget"', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }, { Name: 'Finance' }, { Name: 'sales' }, { Name: 'SalesTarget' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('SALES');
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(3);
      expect(children.map((c) => c.label)).toEqual(['Sales', 'sales', 'SalesTarget']);
    });
  });

  describe('filter — empty filter returns all objects', () => {
    it('returns all objects when filter is empty string', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Alpha' }, { Name: 'Beta' }, { Name: 'Gamma' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('');
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const children = await provider.getChildren(cubesCat);

      expect(children).toHaveLength(3);
      expect(children.map((c) => c.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('returns all objects when filter was never set', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'X' }, { Name: 'Y' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const children = await provider.getChildren(dimCat);
      expect(children).toHaveLength(2);
    });
  });

  describe('filter — works across multiple node types', () => {
    it('filters Cubes by name', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'SalesCube' }, { Name: 'FinanceCube' }, { Name: 'SalesTarget' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('sales');
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);

      expect(cubes).toHaveLength(2);
      expect(cubes.map((c) => c.label)).toEqual(['SalesCube', 'SalesTarget']);
    });

    it('filters Dimensions by name', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Region' }, { Name: 'Time' }, { Name: 'RegionHierarchy' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('region');
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);

      expect(dims).toHaveLength(2);
      expect(dims.map((d) => d.label)).toEqual(['Region', 'RegionHierarchy']);
    });

    it('filters Processes by name', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'LoadData' }, { Name: 'ExportReport' }, { Name: 'LoadSales' }] }),
      });
      const provider = makeProvider();
      provider.setFilter('load');
      const categories = await getCategories(provider);
      const procCat = categories.find((c) => c.label === 'Processes')!;
      const procs = await provider.getChildren(procCat);

      expect(procs).toHaveLength(2);
      expect(procs.map((p) => p.label)).toEqual(['LoadData', 'LoadSales']);
    });

    it('filters Chores by name', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'NightlyLoad', Active: true }, { Name: 'WeeklyExport', Active: false }, { Name: 'NightlyBackup', Active: true }] }),
      });
      const provider = makeProvider();
      provider.setFilter('nightly');
      const categories = await getCategories(provider);
      const choreCat = categories.find((c) => c.label === 'Chores')!;
      const chores = await provider.getChildren(choreCat);

      expect(chores).toHaveLength(2);
      expect(chores.map((c) => c.label)).toEqual(['NightlyLoad', 'NightlyBackup']);
    });
  });

  // ── Auto-refresh stubs ───────────────────────────────────────────────────────

  describe('startAutoRefresh / stopAutoRefresh stubs', () => {
    it('startAutoRefresh does not throw', () => {
      const provider = makeProvider(false);
      expect(() => provider.startAutoRefresh(5000)).not.toThrow();
    });

    it('stopAutoRefresh does not throw', () => {
      const provider = makeProvider(false);
      expect(() => provider.stopAutoRefresh()).not.toThrow();
    });
  });

  // ── Cube node children ───────────────────────────────────────────────────────

  describe('getChildren(cubeNode) — sub-categories', () => {
    it('returns exactly 4 children: cubeRule(Rules), cubeSubCategory(Dimensions), cubeSubCategory(Views), cubeSubCategory(Private Views)', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Sales' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const cubeNode = cubes[0];

      const children = await provider.getChildren(cubeNode);

      expect(children).toHaveLength(4);
      expect(children[0].nodeType).toBe('cubeRule');
      expect(children[0].label).toBe('Rules');
      expect(children[0].meta.cubeName).toBe('Sales');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[1].nodeType).toBe('cubeSubCategory');
      expect(children[1].label).toBe('Dimensions');
      expect(children[2].nodeType).toBe('cubeSubCategory');
      expect(children[2].label).toBe('Views');
      expect(children[2].meta.subKey).toBe('Views');
      expect(children[3].nodeType).toBe('cubeSubCategory');
      expect(children[3].label).toBe('Private Views');
      expect(children[3].meta.subKey).toBe('PrivateViews');
    });
  });

  // ── Cube sub-category children ───────────────────────────────────────────────

  describe('getChildren(cubeSubCategory) — Dimensions', () => {
    it('returns cubeDimension nodes from API', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }) // _cubeHasRules probe on cube expand: no rules
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }, { Name: 'Time' }] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const subCats = await provider.getChildren(cubes[0]);
      const dimSubCat = subCats.find((c) => c.label === 'Dimensions')!;

      const children = await provider.getChildren(dimSubCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('cubeDimension');
      expect(children[0].label).toBe('Region');
      expect(children[0].meta.cubeName).toBe('Sales');
      expect(children[0].meta.dimName).toBe('Region');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getChildren(cubeSubCategory) — Views', () => {
    it('returns public cubeView nodes from API, sorted alphabetically', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }) // _cubeHasRules probe on cube expand: no rules
        // server returns unsorted; provider must sort alphabetically
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Monthly' }, { Name: 'Default' }] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const subCats = await provider.getChildren(cubes[0]);
      const viewsSubCat = subCats.find((c) => c.label === 'Views')!;

      const children = await provider.getChildren(viewsSubCat);

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.label)).toEqual(['Default', 'Monthly']);
      expect(children[0].nodeType).toBe('cubeView');
      expect(children[0].label).toBe('Default');
      expect(children[0].meta.cubeName).toBe('Sales');
      expect(children[0].meta.viewName).toBe('Default');
      expect(children[0].meta.isPrivate).toBe(false);
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getChildren(cubeSubCategory) — Private Views', () => {
    it('returns private cubeView nodes from API, sorted alphabetically', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }) // _cubeHasRules probe on cube expand: no rules
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'MyScratch' }, { Name: 'Adhoc' }] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const subCats = await provider.getChildren(cubes[0]);
      const privSubCat = subCats.find((c) => c.label === 'Private Views')!;

      const children = await provider.getChildren(privSubCat);

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.label)).toEqual(['Adhoc', 'MyScratch']);
      expect(children[0].nodeType).toBe('cubeView');
      expect(children[0].meta.isPrivate).toBe(true);
      expect(children[0].meta.cubeName).toBe('Sales');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
    });
  });

  // F3: a server once showed a cube with NO views although views existed — no
  // error, no message. The `.catch(() => [])` around the public-views call ate
  // the 401/403/timeout and produced a list indistinguishable from "no views".
  describe('getChildren(cubeSubCategory) — Views failure is not silent', () => {
    /** Expand Cubes → Sales → the named sub-category, with `viewsRes` as the 3rd API reply. */
    async function viewChildrenWith(
      label: 'Views' | 'Private Views',
      viewsRes: { statusCode: number; body: string } | Error,
    ) {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }); // _cubeHasRules probe
      if (viewsRes instanceof Error) {
        mockApiRequest.mockRejectedValueOnce(viewsRes);
      } else {
        mockApiRequest.mockResolvedValueOnce(viewsRes);
      }
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const subCats = await provider.getChildren(cubes[0]);
      return provider.getChildren(subCats.find((c) => c.label === label)!);
    }

    it('surfaces an HTTP failure on public Views as an error node', async () => {
      const children = await viewChildrenWith('Views', {
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'Not authenticated' } }),
      });

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toContain('Not authenticated');
    });

    it('surfaces a network/timeout rejection on public Views as an error node', async () => {
      const children = await viewChildrenWith('Views', new Error('socket hang up'));

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toBe('socket hang up');
    });

    it('stays tolerant on Private Views, but logs instead of swallowing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const children = await viewChildrenWith('Private Views', {
          statusCode: 403,
          body: JSON.stringify({ error: { message: 'Forbidden' } }),
        });

        // No error node: missing rights on PrivateViews are normal.
        expect(children).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('private views for cube "Sales"');
      } finally {
        warn.mockRestore();
      }
    });

    // Disconnect between expanding the cube and expanding its Views node: the
    // empty list stays (an error node would flash on every disconnect), but it
    // is no longer indistinguishable from a genuinely view-less cube in the log.
    it('logs when the server config vanished mid-expand', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockApiRequest
          .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
          .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }); // _cubeHasRules probe
        let connected = true;
        const provider = new Tm1TreeDataProvider(
          () => [TEST_SERVER],
          () => true,
          (id) => (connected && id === TEST_SERVER.id ? TEST_CONFIG : undefined),
        );
        const categories = await getCategories(provider);
        const cubesCat = categories.find((c) => c.label === 'Cubes')!;
        const cubes = await provider.getChildren(cubesCat);
        const subCats = await provider.getChildren(cubes[0]);
        const viewsSubCat = subCats.find((c) => c.label === 'Views')!;

        connected = false; // server disconnected before the Views node expands
        const children = await provider.getChildren(viewsSubCat);

        expect(children).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('no connection config');
        expect(String(warn.mock.calls[0][0])).toContain('Views');
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('getChildren(cubeSubCategory) — error handling', () => {
    it('returns error node when cube sub-category API call fails', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }) // _cubeHasRules probe on cube expand: no rules
        .mockRejectedValueOnce(new Error('Connection refused'));
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const cubesCat = categories.find((c) => c.label === 'Cubes')!;
      const cubes = await provider.getChildren(cubesCat);
      const subCats = await provider.getChildren(cubes[0]);
      const dimSubCat = subCats.find((c) => c.label === 'Dimensions')!;

      const children = await provider.getChildren(dimSubCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toBe('Connection refused');
    });
  });

  // ── Dimension node children ──────────────────────────────────────────────────

  describe('getChildren(dimensionNode) — sub-categories', () => {
    it('returns exactly 3 sub-category nodes: Hierarchies, Attributes, Subsets', async () => {
      mockApiRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Region' }] }),
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const dimNode = dims[0];

      const children = await provider.getChildren(dimNode);

      expect(children).toHaveLength(3);
      expect(children.map((c) => c.label)).toEqual(['Hierarchies', 'Attributes', 'Subsets']);
      for (const child of children) {
        expect(child.nodeType).toBe('dimSubCategory');
        expect(child.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
        expect(child.meta.dimName).toBe('Region');
        expect(child.meta.serverId).toBe(TEST_SERVER.id);
      }
    });
  });

  // ── Dimension sub-category children ─────────────────────────────────────────

  describe('getChildren(dimSubCategory) — Hierarchies', () => {
    it('returns hierarchy nodes from API', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }, { Name: 'Leaves' }] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const hierSubCat = subCats.find((c) => c.label === 'Hierarchies')!;

      const children = await provider.getChildren(hierSubCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('hierarchy');
      expect(children[0].label).toBe('Region');
      expect(children[0].meta.dimName).toBe('Region');
      expect(children[0].meta.hierName).toBe('Region');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getChildren(dimSubCategory) — Attributes', () => {
    it('returns attribute nodes from API', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Caption', Type: 'Alias' }, { Name: 'Code', Type: 'String' }] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const attrSubCat = subCats.find((c) => c.label === 'Attributes')!;

      const children = await provider.getChildren(attrSubCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('attribute');
      expect(children[0].label).toBe('Caption');
      expect(children[0].meta.dimName).toBe('Region');
      expect(children[0].meta.attrName).toBe('Caption');
      expect(children[0].meta.attrType).toBe('Alias');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
    });
  });

  describe('getChildren(dimSubCategory) — Subsets', () => {
    it('returns subset nodes from API', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Europe' }, { Name: 'Asia' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const subsetSubCat = subCats.find((c) => c.label === 'Subsets')!;

      const children = await provider.getChildren(subsetSubCat);

      expect(children).toHaveLength(2);
      expect(children[0].nodeType).toBe('subset');
      expect(children[0].label).toBe('Europe');
      expect(children[0].meta.dimName).toBe('Region');
      expect(children[0].meta.subsetName).toBe('Europe');
      expect(children[0].meta.serverId).toBe(TEST_SERVER.id);
      expect(children[0].collapsibleState).toBe(TreeItemCollapsibleState.None);
      expect(children[1].label).toBe('Asia');
    });

    // The `Expression` read by the listing must reach the node's meta — that is
    // what lets the tree say "dynamic" instead of presenting an MDX-driven
    // subset as if it were a fixed element list.
    it('carries the dynamic (MDX) flag from REST through to the node meta', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
          { Name: 'Europe', Expression: '{TM1SUBSETALL([Region])}' },
          { Name: 'Asia', Expression: null },
        ] }) })
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
          { Name: 'Mine', Expression: '{[Region].Members}' },
        ] }) });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const subsetSubCat = subCats.find((c) => c.label === 'Subsets')!;

      const children = await provider.getChildren(subsetSubCat);

      expect(children.map((c) => [c.label, c.meta.isPrivate, c.meta.isDynamic])).toEqual([
        ['Europe', false, true],
        ['Asia', false, false],
        ['Mine', true, true],
      ]);
      expect(children[0].description).toBe(DYNAMIC_SUBSET_MARK);
      expect(children[1].description).toBeUndefined();
      expect(children[2].description).toBe(`private ${DYNAMIC_SUBSET_MARK}`);
    });

    // `Subsets?$select=Name,Expression` is live-verified, and `PrivateSubsets`
    // with the same projection answered 200 everywhere probed on 11.8 — but if
    // any server, version or permission set rejects it, the tree must not
    // silently empty out. Losing the "dynamic" marker beats losing the subsets.
    it('still lists subsets when the server rejects the Expression projection', async () => {
      mockApiRequest.mockImplementation(async (_m: string, path: string) => {
        if (path.includes('Dimensions?')) {
          return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) };
        }
        if (path.includes('Expression')) {
          return { statusCode: 400, body: '{"error":{"message":"projection not supported"}}' };
        }
        if (path.includes('PrivateSubsets')) {
          return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Mine' }] }) };
        }
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Europe' }, { Name: 'Asia' }] }) };
      });
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const subsetSubCat = subCats.find((c) => c.label === 'Subsets')!;

      const children = await provider.getChildren(subsetSubCat);

      expect(children.map((c) => [c.label, c.meta.isPrivate, c.meta.isDynamic])).toEqual([
        ['Europe', false, false],
        ['Asia', false, false],
        ['Mine', true, false],
      ]);
      expect(children.every((c) => c.nodeType === 'subset')).toBe(true);
    });
  });

  describe('getChildren(dimSubCategory) — error handling', () => {
    it('returns error node when dimension sub-category API call fails', async () => {
      mockApiRequest
        .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Region' }] }) })
        .mockRejectedValueOnce(new Error('TM1 Request Timeout (30s)'));
      const provider = makeProvider();
      const categories = await getCategories(provider);
      const dimCat = categories.find((c) => c.label === 'Dimensions')!;
      const dims = await provider.getChildren(dimCat);
      const subCats = await provider.getChildren(dims[0]);
      const hierSubCat = subCats.find((c) => c.label === 'Hierarchies')!;

      const children = await provider.getChildren(hierSubCat);

      expect(children).toHaveLength(1);
      expect(children[0].nodeType).toBe('error');
      expect(children[0].label).toBe('Timeout — is the server reachable?');
    });
  });
});

// ── Process-grouping contextValue (`.grouped` suffix) ─────────────────────────
// The Configure-vs-Reset menu verb is driven per node, not by a global context
// key — two servers live in one tree and may disagree about their grouping.

describe('Tm1TreeDataProvider — process-grouping contextValue', () => {
  const SRV_A = { ...TEST_SERVER, id: 'srv-a', name: 'Server A' };
  const SRV_B = { ...TEST_SERVER, id: 'srv-b', name: 'Server B' };

  let store: Map<string, unknown>;

  function makeCtx(servers: { id: string; name: string }[]) {
    store = new Map<string, unknown>([['tm1.servers', servers]]);
    return {
      globalState: {
        get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
        update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
      },
    } as any;
  }

  function makeProviderFor(servers: typeof SRV_A[]) {
    return new Tm1TreeDataProvider(
      () => servers,
      () => true,
      () => TEST_CONFIG,
    );
  }

  /** Categories of one specific server root. */
  async function categoriesOf(provider: Tm1TreeDataProvider, serverId: string) {
    const roots = await provider.getChildren(undefined);
    const root = roots.find(r => r.nodeType === 'serverRoot' && r.meta.serverId === serverId)!;
    return provider.getChildren(root);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    initServerManager(makeCtx([SRV_A, SRV_B]));
    // Only Server A has a per-server override.
    await setProcessGroupOverride(SRV_A.id, '#####', 'suffix');
  });

  it('marks only the configured server\'s process category with .grouped', async () => {
    const provider = makeProviderFor([SRV_A, SRV_B]);
    const catA = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Processes')!;
    const catB = (await categoriesOf(provider, SRV_B.id)).find(c => c.label === 'Processes')!;

    expect(catA.contextValue).toBe('category-processes.grouped');
    expect(catB.contextValue).toBe('category-processes');
  });

  it('drops the suffix again once the override is cleared', async () => {
    await clearProcessGroupOverride(SRV_A.id);
    const provider = makeProviderFor([SRV_A, SRV_B]);
    const catA = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Processes')!;
    expect(catA.contextValue).toBe('category-processes');
  });

  it('keeps the suffix after the server was renamed (override is id-keyed)', async () => {
    // Rename in place: same id, new name — the override map must not care.
    const renamed = { ...SRV_A, name: 'Server A (renamed)' };
    store.set('tm1.servers', [renamed, SRV_B]);
    const provider = makeProviderFor([renamed, SRV_B]);
    const catA = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Processes')!;
    expect(catA.contextValue).toBe('category-processes.grouped');
  });

  it('marks process group nodes of the configured server with .grouped', async () => {
    mockApiRequest.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: '_Load_#####' }, { Name: '_Load_Cube_A' }] }),
    });
    const provider = makeProviderFor([SRV_A, SRV_B]);
    const catA = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Processes')!;
    const groupsA = await provider.getChildren(catA);
    expect(groupsA[0].nodeType).toBe('processGroup');
    expect(groupsA[0].contextValue).toBe('processGroup.grouped');
  });

  it('builds no group nodes at all for the unconfigured server', async () => {
    mockApiRequest.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: '_Load_#####' }, { Name: '_Load_Cube_A' }] }),
    });
    const provider = makeProviderFor([SRV_A, SRV_B]);
    const catB = (await categoriesOf(provider, SRV_B.id)).find(c => c.label === 'Processes')!;
    const childrenB = await provider.getChildren(catB);
    // No override, no default token — plain process leaves, so there is no group
    // node that could carry the `.grouped` marker in the first place.
    expect(childrenB.map(n => n.nodeType)).toEqual(['process', 'process']);
  });
});

// ── Grouping config source ───────────────────────────────────────────────────
// The global settings tm1.processGroup{Suffix,Mode} are gone and there is no
// default token: the per-server override is the only source of grouping.

describe('Tm1TreeDataProvider — grouping config without an override', () => {
  const SRV = { ...TEST_SERVER, id: 'srv-plain', name: 'Plain' };

  function makeCtx(servers: { id: string; name: string }[]) {
    const store = new Map<string, unknown>([['tm1.servers', servers]]);
    return {
      globalState: {
        get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
        update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
      },
    } as any;
  }

  async function processGroupsOf(provider: Tm1TreeDataProvider) {
    const roots = await provider.getChildren(undefined);
    const root = roots.find(r => r.nodeType === 'serverRoot' && r.meta.serverId === SRV.id)!;
    const cat = (await provider.getChildren(root)).find(c => c.label === 'Processes')!;
    return provider.getChildren(cat);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    initServerManager(makeCtx([SRV])); // no override for SRV
  });

  it('does not group at all — no default token', async () => {
    mockApiRequest.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        // Both marker shapes are present; neither may open a group without an
        // explicit per-server override.
        value: [{ Name: '_Load_#####' }, { Name: '#####_Load' }, { Name: 'Other' }],
      }),
    });
    const provider = new Tm1TreeDataProvider(() => [SRV], () => true, () => TEST_CONFIG);
    const nodes = await processGroupsOf(provider);

    expect(nodes.map(n => n.nodeType)).toEqual(['process', 'process', 'process']);
    expect(nodes.map(n => n.label)).toEqual(['_Load_#####', '#####_Load', 'Other']);
  });

  it('ignores a stale tm1.processGroupSuffix in the user settings', async () => {
    // The setting was removed from the manifest; a leftover value must not reach
    // the tree (the migration folds it into an override instead).
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: (key: string) => (key === 'processGroupSuffix' ? '@@@' : undefined),
    } as any);
    mockApiRequest.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: '_Load_#####' }, { Name: '_Load_Cube_A' }] }),
    });
    const provider = new Tm1TreeDataProvider(() => [SRV], () => true, () => TEST_CONFIG);
    const nodes = await processGroupsOf(provider);

    expect(nodes.map(n => n.nodeType)).toEqual(['process', 'process']);
  });
});

// ── Control objects: per server AND per object group ──────────────────────────
// Before 2026-08-18 the flag was keyed by serverId alone, so unhiding the cubes
// also unhid the dimensions and the processes of that server. The Show/Hide verb
// additionally rode on a window-global context key, which cannot be right once
// two groups (or two servers) disagree — it now sits in the node's contextValue.

describe('Tm1TreeDataProvider — control objects per object group', () => {
  const SRV_A = { ...TEST_SERVER, id: 'ctl-a', name: 'Server A' };
  const SRV_B = { ...TEST_SERVER, id: 'ctl-b', name: 'Server B' };

  function makeProviderFor(
    servers: typeof SRV_A[],
    memento?: { get: <T>(k: string) => T | undefined; update: (k: string, v: unknown) => Thenable<void> },
  ) {
    return new Tm1TreeDataProvider(
      () => servers,
      () => true,
      () => TEST_CONFIG,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      memento,
    );
  }

  async function categoriesOf(provider: Tm1TreeDataProvider, serverId: string) {
    const roots = await provider.getChildren(undefined);
    const root = roots.find(r => r.nodeType === 'serverRoot' && r.meta.serverId === serverId)!;
    return provider.getChildren(root);
  }

  /** Labels of one category's children, with the API answering `names`. */
  async function childLabelsOf(provider: Tm1TreeDataProvider, serverId: string, category: string, names: string[]) {
    const cat = (await categoriesOf(provider, serverId)).find(c => c.label === category)!;
    mockApiRequest.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ value: names.map(Name => ({ Name })) }),
    });
    return (await provider.getChildren(cat)).map(n => n.label);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    const store = new Map<string, unknown>([['tm1.servers', [SRV_A, SRV_B]]]);
    initServerManager({
      globalState: {
        get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
        update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
      },
    } as any);
  });

  it('hides control objects in every group by default', async () => {
    const provider = makeProviderFor([SRV_A]);
    expect(await childLabelsOf(provider, SRV_A.id, 'Cubes', ['Sales', '}Stats'])).toEqual(['Sales']);
    expect(await childLabelsOf(provider, SRV_A.id, 'Dimensions', ['Region', '}Clients'])).toEqual(['Region']);
  });

  it('unhiding the cubes leaves the dimensions of the SAME server hidden', async () => {
    const provider = makeProviderFor([SRV_A]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');

    // Unhidden control objects no longer sit between the user's own
    // cubes, but as a collapsed block IN FRONT of them. `}Stats` is a
    // single item and therefore lands in the leftover bag.
    expect(await childLabelsOf(provider, SRV_A.id, 'Cubes', ['Sales', '}Stats']))
      .toEqual(['Other', 'Sales']);
    expect(await childLabelsOf(provider, SRV_A.id, 'Dimensions', ['Region', '}Clients']))
      .toEqual(['Region']);
  });

  it('puts the unhidden control objects into a collapsed cluster', async () => {
    const provider = makeProviderFor([SRV_A]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');
    const cat = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Cubes')!;
    mockApiRequest.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({
        value: ['Sales', '}bedrock.cube.data.clear', '}bedrock.hier.h.create', '}Stats']
          .map(Name => ({ Name })),
      }),
    });
    const kids = await provider.getChildren(cat);

    expect(kids.map(n => n.label)).toEqual(['bedrock', 'Other', 'Sales']);
    const bedrock = kids[0];
    expect(bedrock.collapsibleState).toBe(1); // Collapsed — expandable, not open
    expect(bedrock.description).toBe('2');
    expect((await provider.getChildren(bedrock)).map(n => n.label))
      .toEqual(['}bedrock.cube.data.clear', '}bedrock.hier.h.create']);
  });

  it('keeps the two servers independent', async () => {
    const provider = makeProviderFor([SRV_A, SRV_B]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');

    expect(await childLabelsOf(provider, SRV_A.id, 'Cubes', ['Sales', '}Stats']))
      .toEqual(['Other', 'Sales']);
    expect(await childLabelsOf(provider, SRV_B.id, 'Cubes', ['Sales', '}Stats']))
      .toEqual(['Sales']);
  });

  it('marks only the unhidden group\'s category node with .ctlShown', async () => {
    const provider = makeProviderFor([SRV_A, SRV_B]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');
    const catsA = await categoriesOf(provider, SRV_A.id);
    const catsB = await categoriesOf(provider, SRV_B.id);

    expect(catsA.find(c => c.label === 'Cubes')!.contextValue).toBe('category-cubes.ctlShown');
    expect(catsA.find(c => c.label === 'Dimensions')!.contextValue).toBe('category-dimensions');
    expect(catsB.find(c => c.label === 'Cubes')!.contextValue).toBe('category-cubes');
  });

  it('appends .ctlShown after the .grouped marker on the process category', async () => {
    await setProcessGroupOverride(SRV_A.id, '#####', 'suffix');
    try {
      const provider = makeProviderFor([SRV_A]);
      provider.toggleSystemObjects(SRV_A.id, 'Processes');
      const cat = (await categoriesOf(provider, SRV_A.id)).find(c => c.label === 'Processes')!;
      expect(cat.contextValue).toBe('category-processes.grouped.ctlShown');
    } finally {
      await clearProcessGroupOverride(SRV_A.id);
    }
  });

  it('toggles back to hidden on a second call', async () => {
    const provider = makeProviderFor([SRV_A]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');
    expect(provider.isHidingSystemObjects(SRV_A.id, 'Cubes')).toBe(true);
    expect(await childLabelsOf(provider, SRV_A.id, 'Cubes', ['Sales', '}Stats'])).toEqual(['Sales']);
  });

  it('keeps control chores hidden — they have no toggle', async () => {
    const provider = makeProviderFor([SRV_A]);
    provider.toggleSystemObjects(SRV_A.id, 'Cubes');
    provider.toggleSystemObjects(SRV_A.id, 'Dimensions');
    provider.toggleSystemObjects(SRV_A.id, 'Processes');
    expect(await childLabelsOf(provider, SRV_A.id, 'Chores', ['Nightly', '}Maint'])).toEqual(['Nightly']);
  });

  it('restores the per-group state from the memento', async () => {
    const store = new Map<string, unknown>();
    const memento = {
      get: <T>(k: string) => store.get(k) as T | undefined,
      update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
    };
    const first = makeProviderFor([SRV_A], memento);
    first.toggleSystemObjects(SRV_A.id, 'Dimensions');

    const second = makeProviderFor([SRV_A], memento);
    expect(second.isHidingSystemObjects(SRV_A.id, 'Dimensions')).toBe(false);
    expect(second.isHidingSystemObjects(SRV_A.id, 'Cubes')).toBe(true);
  });

  it('reports "any group shown" for the usage graph, which spans all kinds', () => {
    const provider = makeProviderFor([SRV_A]);
    expect(provider.isShowingAnyControlObjects(SRV_A.id)).toBe(false);
    provider.toggleSystemObjects(SRV_A.id, 'Processes');
    expect(provider.isShowingAnyControlObjects(SRV_A.id)).toBe(true);
  });
});

describe('Tm1TreeDataProvider — cube load state after our own Unload', () => {
  it('stays unloaded past the 90 s window until the stats count cells again', () => {
    vi.useFakeTimers();
    try {
      const provider = new Tm1TreeDataProvider(() => [], () => true, () => TEST_CONFIG);
      const p = provider as unknown as { _cubeLoad: Map<string, Map<string, boolean>> };
      const node = { meta: { serverId: 's', cubeName: 'Reporting' }, contextValue: 'cube' } as never;
      provider.markCubeLoaded(node, false);
      vi.advanceTimersByTime(91_000);
      expect(provider.cubeLoaded('s', 'Reporting')).toBe(false);
      p._cubeLoad.set('s', new Map([['reporting', true]]));
      expect(provider.cubeLoaded('s', 'Reporting')).toBe(true);
      p._cubeLoad.set('s', new Map());
      expect(provider.cubeLoaded('s', 'Reporting')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
