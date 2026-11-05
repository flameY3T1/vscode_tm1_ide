// The admin server node carries the same handles as a server folder:
// pencil and trash can directly in the row, not only in the context menu.
//
// Menu wiring fails SILENTLY on a typo — the entry
// simply never appears. That is why it is checked here against `package.json` and
// not on the running tree.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';

const ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const viewMenu: Array<{ command: string; when?: string; group?: string }> =
  pkg.contributes.menus['view/item/context'];
const commands: Array<{ command: string; icon?: string }> = pkg.contributes.commands;

const eintraege = (cmd: string) => viewMenu.filter(m => m.command === cmd);
const inline = (cmd: string) => eintraege(cmd).filter(m => (m.group ?? '').startsWith('inline'));
const icon = (cmd: string) => commands.find(c => c.command === cmd)?.icon;

// Both kinds: the classic admin server and a PAW gateway
// (`adminServerRoot-paw`). Only TM1 Top stays restricted to the first — the
// native C API talks to the TM1 port directly and gets through no gateway.
const AM_KNOTEN = 'view == tm1Explorer && viewItem =~ /^adminServerRoot(-paw)?$/';
const NUR_TM1_ADMIN = 'view == tm1Explorer && viewItem == adminServerRoot';
const NUR_PAW = 'view == tm1Explorer && viewItem == adminServerRoot-paw';

describe('admin server node: handles in the row', () => {
  it('puts "Edit" with a pencil into the row — once per kind', () => {
    // Two ids, because the label is static: "Edit admin server" read
    // wrongly under a PAW gateway. Same place, same symbol.
    for (const [cmd, when] of [['tm1.adminServer.edit', NUR_TM1_ADMIN],
      ['tm1.adminServer.editPaw', NUR_PAW]] as const) {
      const m = inline(cmd);
      expect(m, cmd).toHaveLength(1);
      expect(m[0].when, cmd).toBe(when);
      expect(icon(cmd), cmd).toBe('$(edit)');
    }
  });

  it('carries NO trash can anymore — deleting goes through the edit form', () => {
    // Request 2026-09-23: too many icons behind the servers. The delete button
    // of the edit view takes the same path (`adminRemove.ts`).
    for (const cmd of ['tm1.adminServer.remove', 'tm1.adminServer.removePaw'] as const) {
      expect(eintraege(cmd), cmd).toHaveLength(0);
    }
  });

  it('orders them: refresh first, then pencil', () => {
    // Refresh already sat in the row before and stays to the left of it.
    expect(inline('tm1.adminServer.refresh')[0].group! < inline('tm1.adminServer.edit')[0].group!)
      .toBe(true);
  });

  it('keeps one plain contextValue on the admin node', () => {
    const node = new Tm1TreeNode('adminServerRoot', 'Admin', vscode.TreeItemCollapsibleState.Collapsed, { adminId: 'a1' });
    expect(node.contextValue).toBe('adminServerRoot');
  });

  it('offers TM1 Top on admin nodes; the command validates native support', () => {
    const m = eintraege('tm1.adminServer.tm1Top');
    expect(m).toHaveLength(1);
    expect(m[0].when).toBe('view == tm1Explorer && viewItem == adminServerRoot');
    expect(commands.find(c => c.command === 'tm1.adminServer.tm1Top')).toBeTruthy();
  });

  it('does NOT duplicate them into the expanded context menu', () => {
    // Deliberate decision (2026-09-20): the menu was overloaded. Refresh
    // and Edit stand as handles in the row — there and only there.
    for (const cmd of [
      'tm1.adminServer.refresh',
      'tm1.adminServer.edit', 'tm1.adminServer.editPaw',
    ] as const) {
      const imMenue = eintraege(cmd).filter(m => !(m.group ?? '').startsWith('inline'));
      expect(imMenue, cmd).toHaveLength(0);
    }
  });
});

describe('TM1 Top hangs only on the TM1 admin server', () => {
  it('does not appear under a PAW gateway', () => {
    const m = eintraege('tm1.adminServer.tm1Top');
    expect(m).toHaveLength(1);
    // No `(-paw)?`: the menu item must NOT show up there.
    expect(m[0].when).toBe(NUR_TM1_ADMIN);
  });

  it('the remaining admin server menus apply to both kinds', () => {
    for (const cmd of ['tm1.adminServer.refresh', 'tm1.adminServer.restore',
      'tm1.adminServer.hide']) {
      const m = eintraege(cmd);
      expect(m.length, cmd).toBeGreaterThan(0);
      for (const e of m) { expect(e.when, cmd).toBe(AM_KNOTEN); }
    }
  });

  it('a PAW node carries the suffix, a TM1 admin server does not', () => {
    const paw = new Tm1TreeNode('adminServerRoot', 'GW', vscode.TreeItemCollapsibleState.Collapsed,
      { adminId: 'a1', adminKind: 'paw' });
    const tm1 = new Tm1TreeNode('adminServerRoot', 'PROD', vscode.TreeItemCollapsibleState.Collapsed,
      { adminId: 'a2' });
    expect(paw.contextValue).toBe('adminServerRoot-paw');
    expect(tm1.contextValue).toBe('adminServerRoot');
  });
});
