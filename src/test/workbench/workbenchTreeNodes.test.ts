import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { Tm1TreeNode } from '../../providers/tm1TreeNodes';

describe('workbench tree nodes', () => {
  it('gives the root a stable, server-scoped id', () => {
    const a = new Tm1TreeNode('workbenchesRoot', 'Workbenches', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 'http://s' });
    const b = new Tm1TreeNode('workbenchesRoot', 'Workbenches', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 'http://s' });
    expect(a.id).toBe(b.id);
    expect(a.id).toContain('http://s');
  });

  it('ids a workbench by its own id, not by its label', () => {
    const a = new Tm1TreeNode('workbench', 'Quartal', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 'http://s', workbenchId: 'wb-1' });
    const renamed = new Tm1TreeNode('workbench', 'Anderer Name', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 'http://s', workbenchId: 'wb-1' });
    expect(a.id).toBe(renamed.id);
  });

  it('binds a click on a workbench to the restore command', () => {
    const n = new Tm1TreeNode('workbench', 'Quartal', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 'http://s', workbenchId: 'wb-1' });
    expect(n.command?.command).toBe('tm1.workbench.restore');
  });

  it('shows a workbench as a leaf — its windows are not in the tree', () => {
    // The windows stood here as child nodes until 2026-08-24. They were pure
    // information, and the same information is in the edit window, where it also
    // has an effect. An expandable node without children would be an arrow that
    // points into nothing.
    const n = new Tm1TreeNode('workbench', 'Quartal', vscode.TreeItemCollapsibleState.None, { serverId: 'http://s', workbenchId: 'wb-1' });
    expect(n.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(n.command?.command).toBe('tm1.workbench.restore');
  });
});
