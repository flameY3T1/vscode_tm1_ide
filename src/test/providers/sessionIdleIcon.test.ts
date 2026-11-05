// The session dot sits in the server icon, and changing an icon needs a node
// refresh. VS Code answers that by re-asking for the children of expanded nodes
// — on an expired session a request would log in again and turn the dot green
// by itself. This guards that the icon switch serves those from the last answer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { Tm1TreeDataProvider } from '../../providers/tm1TreeDataProvider';

vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: () => {} }));
import { apiRequest } from '../../tm1Rest/client';

const SERVER = { id: 's1', name: 'S1', serverUrl: 'http://s1:1', username: 'u', rejectUnauthorized: false, authType: 'Basic' as const };
const CFG = { serverUrl: 'http://s1:1', username: 'u', password: '', rejectUnauthorized: false, authType: 'Basic' as const };

const make = () => new Tm1TreeDataProvider(() => [SERVER], () => true, () => CFG, undefined, undefined, vscode.Uri.file('/ext'));
const iconName = (n: vscode.TreeItem) => String((n.iconPath as { light: { path: string } }).light.path).split('/').pop();

describe('session dot in the server icon', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) } as never);
  });

  it('switches live → idle on the icon and back', async () => {
    const p = make();
    const [root] = await p.getChildren(undefined);
    expect(iconName(p.getTreeItem(root))).toBe('server-live.svg');
    p.setSessionIdle('s1', true);
    expect(iconName(p.getTreeItem(root))).toBe('server-idle.svg');
    p.setSessionIdle('s1', false);
    expect(iconName(p.getTreeItem(root))).toBe('server-live.svg');
  });

  it('the refresh behind the switch asks the server for nothing', async () => {
    const p = make();
    const [root] = await p.getChildren(undefined);
    const cats = await p.getChildren(root);
    const cubes = cats.find(c => c.meta.categoryKey === 'Cubes' || c.label === 'Cubes')!;
    await p.getChildren(cubes);
    const before = vi.mocked(apiRequest).mock.calls.length;
    expect(before).toBeGreaterThan(0);

    const fired: unknown[] = [];
    p.onDidChangeTreeData(n => fired.push(n));
    p.setSessionIdle('s1', true);
    expect(fired).toEqual([root]);
    // what VS Code does next: children of the refreshed node and of expanded ones
    await p.getChildren(root);
    await p.getChildren(cubes);
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(before);
  });

  it('a real refresh inside the window, and a second ask, still reach the server', async () => {
    const p = make();
    const [root] = await p.getChildren(undefined);
    const cats = await p.getChildren(root);
    const cubes = cats.find(c => c.meta.categoryKey === 'Cubes' || c.label === 'Cubes')!;
    await p.getChildren(cubes);
    p.setSessionIdle('s1', true);
    const before = vi.mocked(apiRequest).mock.calls.length;
    await p.getChildren(cubes); // the icon refresh's own ask: served from memory
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(before);
    await p.getChildren(cubes); // a second ask for the same node: consumed, goes out
    expect(vi.mocked(apiRequest).mock.calls.length).toBeGreaterThan(before);

    p.setSessionIdle('s1', false);
    p.refresh(); // e.g. after creating a cube
    const mid = vi.mocked(apiRequest).mock.calls.length;
    await p.getChildren(cubes);
    expect(vi.mocked(apiRequest).mock.calls.length).toBeGreaterThan(mid);
  });
});
