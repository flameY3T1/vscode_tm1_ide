// VS Code accepts a submenu only ONCE PER MENU ID.
//
// A second entry of the same `submenu` in the same menu is silently
// discarded; the extension host only logs a single line about it:
//
//   The tm1.findReplace submenu was already contributed to the view/item/context menu.
//
// Found on 2026-09-20: `tm1.findReplace` was listed twice under
// `view/item/context` — once on the server node, once on the
// process category. It was only visible on the server node; on the category
// it was missing. No gate noticed: package.json is valid JSON, the
// menu is declared, the command exists.
//
// A submenu on several node kinds therefore needs ONE entry with a
// `when` clause made of several branches (`||`) — not several entries.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes: { menus: Record<string, { submenu?: string; command?: string; when?: string }[]> };
};

describe('package.json — submenus', () => {
  it('contributes every submenu only once per menu', () => {
    const doppelt: string[] = [];
    for (const [menu, eintraege] of Object.entries(pkg.contributes.menus)) {
      const zahl = new Map<string, number>();
      for (const e of eintraege) {
        if (!e.submenu) { continue; }
        zahl.set(e.submenu, (zahl.get(e.submenu) ?? 0) + 1);
      }
      for (const [sub, n] of zahl) {
        if (n > 1) { doppelt.push(`${sub} steht ${n}x in ${menu}`); }
      }
    }
    expect(doppelt, 'VS Code verwirft jeden Eintrag nach dem ersten').toEqual([]);
  });

  it('keeps "Find/Replace" on both node kinds', () => {
    // The concrete case from above: one entry, both branches in the clause.
    const eintraege = pkg.contributes.menus['view/item/context']
      .filter((e) => e.submenu === 'tm1.findReplace');
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].when).toContain('serverRoot-connected');
    expect(eintraege[0].when).toContain('category-processes');
  });
});
