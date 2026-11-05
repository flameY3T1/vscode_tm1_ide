import { describe, it, expect, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { Tm1TreeNode, setGitEnabledResolver, setV12Resolver } from '../providers/tm1TreeNodes';

afterEach(() => { setGitEnabledResolver(() => false); setV12Resolver(() => false); }); // reset

describe('Tm1TreeNode v12 contextValue suffix', () => {
  it('cube node of a v12 server gets contextValue "cube-v12" (hides v11-only SaveData)', () => {
    setV12Resolver((id) => id === 'v12srv');
    const n = new Tm1TreeNode('cube', 'C', vscode.TreeItemCollapsibleState.None, { serverId: 'v12srv' });
    expect(n.contextValue).toBe('cube-v12');
  });

  it('cube node of a v11 server keeps plain "cube"', () => {
    setV12Resolver((id) => id === 'v12srv');
    const n = new Tm1TreeNode('cube', 'C', vscode.TreeItemCollapsibleState.None, { serverId: 'v11srv' });
    expect(n.contextValue).toBe('cube');
  });

  it('leaves non-cube nodes untouched on v12', () => {
    setV12Resolver(() => true);
    const n = new Tm1TreeNode('dimension', 'D', vscode.TreeItemCollapsibleState.None, { serverId: 'v12srv' });
    expect(n.contextValue).toBe('dimension');
  });
});

describe('Tm1TreeNode git contextValue suffix', () => {
  it('process node of git-enabled server gets contextValue "process.git"', () => {
    setGitEnabledResolver((id) => id === 's1');
    const n = new Tm1TreeNode('process', 'P', vscode.TreeItemCollapsibleState.None, { serverId: 's1' });
    expect(n.contextValue).toBe('process.git');
  });

  it('process node of git-disabled server keeps "process"', () => {
    setGitEnabledResolver(() => false);
    const n = new Tm1TreeNode('process', 'P', vscode.TreeItemCollapsibleState.None, { serverId: 's1' });
    expect(n.contextValue).toBe('process');
  });

  it('cubeRule node respects the resolver', () => {
    setGitEnabledResolver(() => true);
    const n = new Tm1TreeNode('cubeRule', 'C', vscode.TreeItemCollapsibleState.None, { serverId: 's1', cubeName: 'C' });
    expect(n.contextValue).toBe('cubeRule.git');
  });

  it('non-process/cubeRule node is unaffected', () => {
    setGitEnabledResolver(() => true);
    const n = new Tm1TreeNode('dimension', 'D', vscode.TreeItemCollapsibleState.None, { serverId: 's1' });
    expect(n.contextValue).toBe('dimension');
  });

  it('connected serverRoot of git-enabled server gets contextValue "serverRoot-connected.git"', () => {
    setGitEnabledResolver((id) => id === 's1');
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: true });
    expect(n.contextValue).toBe('serverRoot-connected.git');
  });

  it('connected serverRoot of git-disabled server keeps "serverRoot-connected"', () => {
    setGitEnabledResolver(() => false);
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: true });
    expect(n.contextValue).toBe('serverRoot-connected');
  });

  it('disconnected serverRoot of git-enabled server keeps "serverRoot-disconnected"', () => {
    setGitEnabledResolver((id) => id === 's1');
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: false });
    expect(n.contextValue).toBe('serverRoot-disconnected');
  });

  it('connected v12 serverRoot gets contextValue "serverRoot-connected-v12"', () => {
    setGitEnabledResolver(() => false);
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: true, isV12: true });
    expect(n.contextValue).toBe('serverRoot-connected-v12');
  });

  it('connected v12 serverRoot of git-enabled server → "serverRoot-connected-v12.git"', () => {
    setGitEnabledResolver((id) => id === 's1');
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: true, isV12: true });
    expect(n.contextValue).toBe('serverRoot-connected-v12.git');
  });

  it('connected v11 serverRoot (isV12 falsy) keeps "serverRoot-connected"', () => {
    setGitEnabledResolver(() => false);
    const n = new Tm1TreeNode('serverRoot', 'S', vscode.TreeItemCollapsibleState.Collapsed, { serverId: 's1', connected: true, isV12: false });
    expect(n.contextValue).toBe('serverRoot-connected');
  });
});
