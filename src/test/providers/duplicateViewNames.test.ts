import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

const getCubeViewsSpy = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/cubeApi', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../tm1Rest/cubeApi');
  return { ...actual, getCubeViews: getCubeViewsSpy };
});

import * as vscode from 'vscode';
import { Tm1TreeDataProvider } from '../../providers/tm1TreeDataProvider';
import { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { dedupeTreeNodeIds } from '../../providers/treeNodeIdDedupePure';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = {
  serverUrl: 'https://h:1', username: 'u', password: 'p',
  authType: 'Basic', rejectUnauthorized: false,
} as unknown as Tm1Config;

function makeProvider(): Tm1TreeDataProvider {
  return new Tm1TreeDataProvider(() => [], () => true, () => CFG);
}

function viewsNode(): Tm1TreeNode {
  return new Tm1TreeNode(
    'cubeSubCategory', 'Views', vscode.TreeItemCollapsibleState.Collapsed,
    { cubeName: 'Reporting_Revenue', subKey: 'Views', serverId: 'srv-1' },
  );
}

describe('views with the same name on one cube', () => {
  beforeEach(() => { getCubeViewsSpy.mockReset(); });

  it('gives a native and an MDX view of the same name different ids', async () => {
    // The reported case (2026-09-01): `Reporting_Revenue` carries `Standard`
    // twice — once native, once MDX. Both showed up in the selection field of the
    // Cube Viewer, while in the tree the whole "Views" branch stayed empty, because VS Code
    // throws "Element with id ... is already registered" on a duplicate id.
    getCubeViewsSpy.mockImplementation(async (_cfg: unknown, _cube: string, isPrivate: boolean) =>
      (isPrivate ? [] : [
        { name: 'Standard', isPrivate: false, isMdx: false },
        { name: 'Standard', isPrivate: false, isMdx: true },
      ]));

    const kids = await makeProvider().getChildren(viewsNode());

    expect(kids).toHaveLength(2);
    expect(kids.map(k => k.label)).toEqual(['Standard', 'Standard {}']);
    expect(new Set(kids.map(k => k.id)).size).toBe(2);
    // The id separates via the MDX flag, not via the emergency guard.
    expect(kids.map(k => k.id)).toEqual([
      'srv-1:view:Reporting_Revenue:Standard',
      'srv-1:view:mdx:Reporting_Revenue:Standard',
    ]);
  });

  it('also keeps apart two views that are identical in EVERY respect', async () => {
    // Emergency guard: if both are native, the MDX flag does not help. The branch
    // must still stand — a duplicate name costs a duplicate
    // node, not the whole list.
    getCubeViewsSpy.mockImplementation(async (_cfg: unknown, _cube: string, isPrivate: boolean) =>
      (isPrivate ? [] : [
        { name: 'Standard', isPrivate: false, isMdx: false },
        { name: 'Standard', isPrivate: false, isMdx: false },
      ]));

    const kids = await makeProvider().getChildren(viewsNode());

    expect(kids).toHaveLength(2);
    expect(new Set(kids.map(k => k.id)).size).toBe(2);
    // The user sees both under their real name.
    expect(kids.map(k => k.label)).toEqual(['Standard', 'Standard']);
    // Both point to the same view — the meta stays untouched.
    expect(kids.map(k => k.meta.viewName)).toEqual(['Standard', 'Standard']);
  });
});

describe('dedupeTreeNodeIds', () => {
  it('leaves a collision-free list unchanged', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupeTreeNodeIds(nodes).map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('numbers every further repetition consecutively', () => {
    const nodes = [{ id: 'a' }, { id: 'a' }, { id: 'a' }, { id: 'b' }];
    expect(dedupeTreeNodeIds(nodes).map(n => n.id)).toEqual(['a', 'a::dup2', 'a::dup3', 'b']);
  });

  it('falls back further when the fallback name itself is already taken', () => {
    const nodes = [{ id: 'a' }, { id: 'a::dup2' }, { id: 'a' }];
    expect(dedupeTreeNodeIds(nodes).map(n => n.id)).toEqual(['a', 'a::dup2', 'a::dup3']);
  });

  it('does not touch nodes without an id — VS Code assigns one there itself', () => {
    const nodes = [{ id: undefined }, { id: undefined }, { id: '' }];
    expect(dedupeTreeNodeIds(nodes).map(n => n.id)).toEqual([undefined, undefined, '']);
  });
});
