import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWindow, unregisterWindow, listWindows, clearWindowsForTest,
} from '../../workbench/windowRegistry';

const panel = (name: string) => ({ name });

describe('windowRegistry', () => {
  beforeEach(() => clearWindowsForTest());

  it('keeps registrations in order', () => {
    registerWindow({ kind: 'cubeViewer', rawKey: 'http://s:Reporting', panel: panel('a'), serverId: 'http://s', target: 'Reporting' });
    registerWindow({ kind: 'messageLog', rawKey: 'http://s', panel: panel('b') });
    expect(listWindows().map(w => w.kind)).toEqual(['cubeViewer', 'messageLog']);
  });

  it('removes by panel identity, not by key', () => {
    const a = panel('a');
    const b = panel('b');
    registerWindow({ kind: 'k', rawKey: 'same', panel: a });
    registerWindow({ kind: 'k', rawKey: 'same', panel: b });
    unregisterWindow(a);
    expect(listWindows()).toHaveLength(1);
    expect(listWindows()[0].panel).toBe(b);
  });

  it('ignores an unregister for a panel it never saw', () => {
    registerWindow({ kind: 'k', rawKey: 'x', panel: panel('a') });
    unregisterWindow(panel('ghost'));
    expect(listWindows()).toHaveLength(1);
  });

  it('replaces an entry when the same panel registers twice', () => {
    const a = panel('a');
    registerWindow({ kind: 'k', rawKey: 'x', panel: a });
    registerWindow({ kind: 'k', rawKey: 'y', panel: a });
    expect(listWindows()).toHaveLength(1);
    expect(listWindows()[0].rawKey).toBe('y');
  });
});
