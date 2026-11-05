import { describe, it, expect, vi } from 'vitest';
vi.mock('../tm1Rest/applicationsApi', () => {
  const stub = vi.fn(async () => ([
    { id: 'DemoApp', name: 'DemoApp', type: 'folder', isPrivate: false },
    { id: 'p.xlsx.blob', name: 'p.xlsx', type: 'document', isPrivate: false },
  ]));
  return { listApplications: stub };
});
// _childrenForServerRoot calls isSandboxEnabled(cfg), which otherwise makes a
// real network call against the fake `cfg.serverUrl` and times the test out.
vi.mock('../tm1Rest/sandboxApi', () => ({
  isSandboxEnabled: vi.fn(async () => true),
}));
import { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';

const cfg = { serverUrl: 'http://x', username: 'u', authType: 'basic' } as any;
function makeProvider() {
  return new Tm1TreeDataProvider(
    () => [{ id: 's1', name: 'S1' } as any],
    () => true,
    () => cfg,
  );
}

describe('applications provider', () => {
  it('applicationsRoot expands to folder + doc nodes plus Data Files child', async () => {
    const p = makeProvider();
    const root = new Tm1TreeNode('applicationsRoot', 'Applications', 1, { serverId: 's1', appPath: [] });
    const kids = await p.getChildren(root);
    const types = kids.map(k => k.nodeType);
    expect(types).toContain('applicationFolder');
    expect(types).toContain('applicationDoc');
    expect(types).toContain('filesRoot');            // Data Files child
    expect(kids.find(k => k.nodeType === 'filesRoot')?.label).toBe('Data Files');
  });
  it('server root contains an applicationsRoot and no top-level filesRoot', async () => {
    const p = makeProvider();
    const sr = new Tm1TreeNode('serverRoot', 'S1', 1, { serverId: 's1', connected: true });
    const kids = await p.getChildren(sr);
    expect(kids.some(k => k.nodeType === 'applicationsRoot')).toBe(true);
    expect(kids.some(k => k.nodeType === 'filesRoot')).toBe(false);
  });
});
