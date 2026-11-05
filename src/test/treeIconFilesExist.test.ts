/**
 * Every icon that `getIconForNodeType` names must exist as a file in BOTH
 * themes.
 *
 * `tm1TreeNodes.test.ts` only checks the returned path — whether anything
 * actually sits there, it does not check. A typo in the name or a file that
 * only arrives in one of the two directories during a rename therefore
 * goes unnoticed everywhere: VS Code then simply shows the node without an icon,
 * without an error and without a message.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const NODES = path.join(ROOT, 'src', 'providers', 'tm1TreeNodes.ts');
const ICONS = path.join(ROOT, 'media', 'icons');

/** All names from `iconPath(extensionUri, '<name>')` in the source. */
function iconNames(): string[] {
  const src = fs.readFileSync(NODES, 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/iconPath\([^,]+,\s*(?:meta\.\w+\s*\?\s*)?'([\w-]+)'(?:\s*:\s*'([\w-]+)')?/g)) {
    names.add(m[1]);
    if (m[2]) { names.add(m[2]); }
  }
  return [...names].sort();
}

describe('tree icons: every named SVG actually exists', () => {
  it('finds any names in the source at all', () => {
    // Otherwise the test below passes green without having checked anything.
    expect(iconNames().length).toBeGreaterThan(20);
  });

  it('has a light AND a dark file for every name', () => {
    const missing: string[] = [];
    for (const name of iconNames()) {
      for (const theme of ['light', 'dark']) {
        const p = path.join(ICONS, theme, `${name}.svg`);
        if (!fs.existsSync(p)) { missing.push(`${theme}/${name}.svg`); }
      }
    }
    expect(missing).toEqual([]);
  });

  it('knows the admin server node', () => {
    expect(iconNames()).toContain('admin-server');
  });
});
