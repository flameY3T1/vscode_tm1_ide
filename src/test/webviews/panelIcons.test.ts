import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { PANEL_ICONS } from '../../webviews/panelIcons';

// A typo in a viewType or an icon name fails silently: the tab just keeps
// VS Code's default icon. Both ends are checked here.
describe('panel tab icons', () => {
  it('every mapped SVG exists in light and dark', () => {
    for (const name of Object.values(PANEL_ICONS)) {
      for (const theme of ['light', 'dark']) {
        expect(existsSync(`media/icons/${theme}/${name}.svg`), `${theme}/${name}.svg`).toBe(true);
      }
    }
  });

  it('every mapped viewType is one a panel is really created with', () => {
    const src = execSync("grep -rhoE \"'[A-Za-z0-9._]+'\" src --include=*.ts --exclude-dir=test", { encoding: 'utf8' });
    const literals = new Set(src.split('\n').map(l => l.slice(1, -1)));
    for (const vt of Object.keys(PANEL_ICONS)) {
      expect(literals.has(vt), vt).toBe(true);
    }
    expect(readFileSync('src/webviews/webviewPanelHost.ts', 'utf8')).toContain('setPanelIcon(panel, this.viewType)');
  });
});
