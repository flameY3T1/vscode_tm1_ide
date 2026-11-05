// Regression guard: only ONE "+" button on the tree title of tm1Explorer.
//
// Before, `tm1.addServer` AND `tm1.adminServer.add` both stood in
// `view/title`, group `navigation@0` — two plus icons side by side, although
// the Add Server dialog has covered both kinds since the kind switch
// (Instance | Admin server) (click-test feedback, 2026-08-27). `tm1.adminServer.add`
// stays registered as a command and reachable via the Command Palette.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes: {
    menus: { 'view/title': { command: string; when?: string; group?: string }[] };
    commands: { command: string; title: string }[];
  };
};

describe('tm1Explorer view/title: exactly one button for adding a server', () => {
  it('has exactly one navigation@0 entry for tm1Explorer out of {addServer, adminServer.add}', () => {
    const entries = pkg.contributes.menus['view/title'].filter(
      (i) =>
        i.when === 'view == tm1Explorer' &&
        i.group === 'navigation@0' &&
        (i.command === 'tm1.addServer' || i.command === 'tm1.adminServer.add'),
    );
    expect(entries.map((i) => i.command)).toEqual(['tm1.addServer']);
  });

  it('tm1.adminServer.add stays declared as a command (Command Palette)', () => {
    expect(pkg.contributes.commands.some((c) => c.command === 'tm1.adminServer.add')).toBe(true);
  });

  it('tm1.adminServer.add has NO "when": "false" in the Command Palette', () => {
    const commandPalette = (pkg.contributes.menus as unknown as Record<string, { command: string; when?: string }[]>).commandPalette;
    const hidden = commandPalette.filter((i) => i.command === 'tm1.adminServer.add' && i.when === 'false');
    expect(hidden).toEqual([]);
  });
});
