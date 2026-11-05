// Menu wiring fails SILENTLY on a typo: the entry
// simply never appears, there is no error and no log. Three things
// have to fit together, and they live in three different files —
// `package.json` (command + `when`), `registerWorkbenchCommands.ts`
// (registration) and `tm1TreeNodes.ts` (the `contextValue` that the
// `when` refers to).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const nlsEn = JSON.parse(readFileSync(join(ROOT, 'package.nls.json'), 'utf8'));
const nlsDe = JSON.parse(readFileSync(join(ROOT, 'package.nls.de.json'), 'utf8'));
const registrierung = readFileSync(
  join(ROOT, 'src', 'activation', 'registerWorkbenchCommands.ts'), 'utf8');

const viewMenu: Array<{ command: string; when?: string; group?: string }> =
  pkg.contributes.menus['view/item/context'];
const eintrag = (cmd: string) => viewMenu.filter(m => m.command === cmd);

describe('Workbench-Menues', () => {
  it('hangs "Save" on the Workbenches node, no longer on the server', () => {
    const m = eintrag('tm1.workbench.save');
    expect(m).toHaveLength(1);
    expect(m[0].when).toBe('viewItem == workbenchesRoot');
    // The node hangs unconditionally under every connected server — so even with
    // zero workbenches the command is reachable.
    expect(m[0].when).not.toContain('serverRoot');
  });

  it('hangs "Edit" on the workbench', () => {
    const m = eintrag('tm1.workbench.edit');
    expect(m).toHaveLength(1);
    expect(m[0].when).toBe('viewItem == workbench');
  });

  it('puts Edit before Rename', () => {
    const g = (cmd: string) => eintrag(cmd)[0].group ?? '';
    expect(g('tm1.workbench.edit') < g('tm1.workbench.rename')).toBe(true);
  });

  it('also registers every menu command', () => {
    for (const cmd of ['tm1.workbench.save', 'tm1.workbench.edit',
      'tm1.workbench.restore', 'tm1.workbench.rename', 'tm1.workbench.delete']) {
      expect(pkg.contributes.commands.some((c: { command: string }) => c.command === cmd)).toBe(true);
      expect(registrierung.includes(`'${cmd}'`)).toBe(true);
    }
  });

  it('hides the workbench commands in the command palette', () => {
    // They need a node as argument; called from the palette they would do
    // nothing or the wrong thing.
    const palette: Array<{ command: string; when?: string }> = pkg.contributes.menus.commandPalette;
    for (const cmd of ['tm1.workbench.save', 'tm1.workbench.edit']) {
      expect(palette.find(m => m.command === cmd)?.when).toBe('false');
    }
  });

  it('translates every title in both bundles', () => {
    for (const cmd of ['tm1.workbench.save', 'tm1.workbench.edit']) {
      const key = pkg.contributes.commands.find((c: { command: string }) => c.command === cmd).title;
      expect(key).toMatch(/^%.+%$/);
      const bare = key.slice(1, -1);
      expect(nlsEn[bare], `EN fehlt: ${bare}`).toBeTruthy();
      expect(nlsDe[bare], `DE fehlt: ${bare}`).toBeTruthy();
    }
  });
});
