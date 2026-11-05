import { describe, it, expect, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { Tm1TreeNode, setGitEnabledResolver } from '../providers/tm1TreeNodes';

afterEach(() => {
  setGitEnabledResolver(() => false);
});

function node(meta: Record<string, unknown>): Tm1TreeNode {
  return new Tm1TreeNode(
    'serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed,
    { serverId: 's1', ...meta },
  );
}

/**
 * The exact forms are a contract: the 19 `when` clauses on `serverRoot` in
 * package.json depend on them (cross-check:
 * `serverRootMenuWhenClauses.test.ts`).
 */
describe('serverRoot contextValue: -adm marker', () => {
  it.each([
    ['connected v11, ohne Adminserver', { connected: true }, 'serverRoot-connected'],
    ['connected v11, aus Adminserver', { connected: true, fromAdmin: true }, 'serverRoot-connected-adm'],
    ['connected v12, ohne Adminserver', { connected: true, isV12: true }, 'serverRoot-connected-v12'],
    ['connected v12, aus Adminserver', { connected: true, isV12: true, fromAdmin: true }, 'serverRoot-connected-v12-adm'],
    ['disconnected, ohne Adminserver', { connected: false }, 'serverRoot-disconnected'],
    ['disconnected, aus Adminserver', { connected: false, fromAdmin: true }, 'serverRoot-disconnected-adm'],
    // Disconnected: NO `-v12`. The marker only sits on connected nodes, because
    // there it removes v11-only actions from the menu; on disconnected nodes
    // all `when` clauses anchor on the bare form.
    ['disconnected v12, ohne Adminserver', { connected: false, isV12: true }, 'serverRoot-disconnected'],
    ['disconnected v12, aus Adminserver', { connected: false, isV12: true, fromAdmin: true }, 'serverRoot-disconnected-adm'],
  ])('%s → %s', (_label, meta, expected) => {
    expect(node(meta).contextValue).toBe(expected);
  });

  it('puts -adm BEFORE the .git suffix', () => {
    setGitEnabledResolver(() => true);
    expect(node({ connected: true, fromAdmin: true }).contextValue)
      .toBe('serverRoot-connected-adm.git');
    expect(node({ connected: true, isV12: true, fromAdmin: true }).contextValue)
      .toBe('serverRoot-connected-v12-adm.git');
  });

  it('a disconnected node gets no .git suffix, but does get -adm', () => {
    setGitEnabledResolver(() => true);
    expect(node({ connected: false, fromAdmin: true }).contextValue)
      .toBe('serverRoot-disconnected-adm');
    expect(node({ connected: false, isV12: true, fromAdmin: true }).contextValue)
      .toBe('serverRoot-disconnected-adm');
  });

  it('fromAdmin only applies to serverRoot, not to other node types', () => {
    const n = new Tm1TreeNode('dimension', 'D', vscode.TreeItemCollapsibleState.None, { serverId: 's1', fromAdmin: true });
    expect(n.contextValue).toBe('dimension');
  });
});
