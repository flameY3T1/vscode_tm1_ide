import { describe, it, expect, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { Tm1TreeNode, setGitEnabledResolver, setV12Resolver } from '../providers/tm1TreeNodes';

afterEach(() => { setGitEnabledResolver(() => false); setV12Resolver(() => false); }); // reset

const NONE = vscode.TreeItemCollapsibleState.None;

describe('Tm1TreeNode control-object contextValue suffix', () => {
  it('control dimension gets "dimension-control"', () => {
    const n = new Tm1TreeNode('dimension', '}ElementAttributes_Product', NONE,
      { dimName: '}ElementAttributes_Product', serverId: 's1' });
    expect(n.contextValue).toBe('dimension-control');
  });

  it('normal dimension keeps "dimension"', () => {
    const n = new Tm1TreeNode('dimension', 'Product', NONE, { dimName: 'Product', serverId: 's1' });
    expect(n.contextValue).toBe('dimension');
  });

  it('control cube on a v11 server gets "cube-control"', () => {
    const n = new Tm1TreeNode('cube', '}ClientGroups', NONE, { cubeName: '}ClientGroups', serverId: 's1' });
    expect(n.contextValue).toBe('cube-control');
  });

  it('control cube on a v12 server gets "cube-v12-control"', () => {
    setV12Resolver((id) => id === 'v12srv');
    const n = new Tm1TreeNode('cube', '}ClientGroups', NONE, { cubeName: '}ClientGroups', serverId: 'v12srv' });
    expect(n.contextValue).toBe('cube-v12-control');
  });

  it('normal cube on a v12 server still gets plain "cube-v12"', () => {
    setV12Resolver((id) => id === 'v12srv');
    const n = new Tm1TreeNode('cube', 'Sales', NONE, { cubeName: 'Sales', serverId: 'v12srv' });
    expect(n.contextValue).toBe('cube-v12');
  });

  it('hierarchy of a control dimension gets "hierarchy-control"', () => {
    const n = new Tm1TreeNode('hierarchy', '}ElementAttributes_Product', NONE,
      { dimName: '}ElementAttributes_Product', hierName: '}ElementAttributes_Product', serverId: 's1' });
    expect(n.contextValue).toBe('hierarchy-control');
  });

  it('control hierarchy under a normal dimension gets "hierarchy-control"', () => {
    const n = new Tm1TreeNode('hierarchy', '}Leaves', NONE,
      { dimName: 'Product', hierName: '}Leaves', serverId: 's1' });
    expect(n.contextValue).toBe('hierarchy-control');
  });

  it('normal hierarchy keeps "hierarchy"', () => {
    const n = new Tm1TreeNode('hierarchy', 'Product', NONE,
      { dimName: 'Product', hierName: 'Product', serverId: 's1' });
    expect(n.contextValue).toBe('hierarchy');
  });

  it('cubeDimension is NOT suffixed — there is no delete command there', () => {
    const n = new Tm1TreeNode('cubeDimension', '}Clients', NONE,
      { cubeName: '}ClientGroups', dimName: '}Clients', serverId: 's1' });
    expect(n.contextValue).toBe('cubeDimension');
  });

  it('falls back to the label when the name meta is missing', () => {
    const n = new Tm1TreeNode('dimension', '}Groups', NONE, { serverId: 's1' });
    expect(n.contextValue).toBe('dimension-control');
  });

  it('cube with an existing picklist cube gets "cube-haspick"', () => {
    const n = new Tm1TreeNode('cube', 'Sales', NONE,
      { cubeName: 'Sales', serverId: 's1', hasPicklistCube: true });
    expect(n.contextValue).toBe('cube-haspick');
  });

  it('combines with the v12 axis', () => {
    setV12Resolver((id) => id === 'v12srv');
    const n = new Tm1TreeNode('cube', 'Sales', NONE,
      { cubeName: 'Sales', serverId: 'v12srv', hasPicklistCube: true });
    expect(n.contextValue).toBe('cube-v12-haspick');
  });

  it('never suffixes a control cube — a }PickList_X has none itself', () => {
    const n = new Tm1TreeNode('cube', '}PickList_Sales', NONE,
      { cubeName: '}PickList_Sales', serverId: 's1', hasPicklistCube: true });
    expect(n.contextValue).toBe('cube-control');
  });

  it('cube without a picklist cube keeps plain "cube"', () => {
    const n = new Tm1TreeNode('cube', 'Sales', NONE,
      { cubeName: 'Sales', serverId: 's1', hasPicklistCube: false });
    expect(n.contextValue).toBe('cube');
  });

  it('picklist flag does not change the node id', () => {
    const a = new Tm1TreeNode('cube', 'Sales', NONE, { cubeName: 'Sales', serverId: 's1' });
    const b = new Tm1TreeNode('cube', 'Sales', NONE,
      { cubeName: 'Sales', serverId: 's1', hasPicklistCube: true });
    expect(b.id).toBe(a.id);
  });

  it('leaves the node id untouched (stable ids, otherwise the tree collapses)', () => {
    const ctrl = new Tm1TreeNode('dimension', '}Groups', NONE, { dimName: '}Groups', serverId: 's1' });
    const cube = new Tm1TreeNode('cube', '}ClientGroups', NONE, { cubeName: '}ClientGroups', serverId: 's1' });
    const hier = new Tm1TreeNode('hierarchy', '}Groups', NONE,
      { dimName: '}Groups', hierName: '}Groups', serverId: 's1' });
    expect(ctrl.id).toBe('s1:dim:}Groups');
    expect(cube.id).toBe('s1:cube:}ClientGroups');
    expect(hier.id).toBe('s1:hier:}Groups:}Groups');
  });
});
