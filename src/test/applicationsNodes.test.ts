import { describe, it, expect } from 'vitest';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';

describe('application nodes', () => {
  it('folder id is path-based and stable', () => {
    const n = new Tm1TreeNode('applicationFolder', 'DemoApp',
      1 /*Collapsed*/, { serverId: 's1', appPath: ['DemoApp'] });
    expect(n.id).toBe('s1:app:DemoApp');
    expect(n.contextValue).toBe('applicationFolder');
  });
  it('nested folder id includes full path', () => {
    const n = new Tm1TreeNode('applicationFolder', 'Personal',
      1, { serverId: 's1', appPath: ['DemoApp', 'Personal'] });
    expect(n.id).toBe('s1:app:DemoApp/Personal');
  });
  it('private doc shows badge in description', () => {
    const n = new Tm1TreeNode('applicationDoc', 'x.xlsx',
      0 /*None*/, { serverId: 's1', appPath: ['DemoApp'], appId: 'x.xlsx.blob', isPrivate: true });
    expect(String(n.description)).toContain('private');
  });
  it('doc node binds openDocument command', () => {
    const n = new Tm1TreeNode('applicationDoc', 'x.xlsx',
      0, { serverId: 's1', appPath: ['DemoApp'], appId: 'x.xlsx.blob' });
    expect(n.command?.command).toBe('tm1.app.openDocument');
  });
  it('link node binds openLink command', () => {
    const n = new Tm1TreeNode('applicationLink', 'l',
      0, { serverId: 's1', url: 'https://example.com' });
    expect(n.command?.command).toBe('tm1.app.openLink');
  });
});
