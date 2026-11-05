import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Source guard: there is only ONE load path.
 *
 * The switch `tm1.dimensionBrowser.newPath` was dropped on 2026-08-23
 * (slice 1 of the teardown). The predecessor of this guard was
 * `dimBrowserLegacyDoorGuard.test.ts`, which checked that EVERY door into the old
 * path asks the switch — a question that no longer exists.
 *
 * What remains to be secured: that the switch does not come back. Two paths
 * cost twice on every bug, and a reintroduced flag would be
 * exactly that, without anyone noticing while reading a single file.
 */
const SRC = path.join(__dirname, '..');

function alleQuellen(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'test-integration') { continue; }
      alleQuellen(p, out);
    } else if (e.name.endsWith('.ts')) { out.push(p); }
  }
  return out;
}

describe('One load path, no switch', () => {
  const dateien = alleQuellen(SRC);

  it('no source code asks for the switch anymore', () => {
    const treffer = dateien.filter((f) => {
      const s = fs.readFileSync(f, 'utf8');
      return /isNewViewPathActive|__tm1NewViewPath/.test(s);
    });
    expect(treffer.map((f) => path.basename(f))).toEqual([]);
  });

  it('the setting is no longer in the manifest', () => {
    const pkg = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
    expect(pkg).not.toContain('dimensionBrowser.newPath');
  });

  it('the old reordering path is gone — `viewDrag` is the only one', () => {
    const alt = path.join(SRC, 'webviewClient', 'dimensionBrowser', 'dragDrop.ts');
    expect(fs.existsSync(alt)).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'webviewClient', 'dimensionBrowser', 'viewDrag.ts'))).toBe(true);
  });

  it('no control of the old path is attached to a handler anymore', () => {
    // Slice 2: the old elements are no longer merely hidden, their
    // wiring is gone. So no refusal is needed anymore either — there is
    // nothing that could reach it.
    const dom = fs.readFileSync(path.join(SRC, 'webviewClient', 'dimensionBrowser', 'dom.ts'), 'utf8');
    for (const alt of ['btn-show-all', 'btn-keep-marked', 'btn-remove-marked', 'initFilters(', 'initTableEvents(']) {
      expect(dom).not.toContain(alt);
    }
    expect(fs.existsSync(path.join(SRC, 'webviewClient', 'dimensionBrowser', 'domFilters.ts'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'webviewClient', 'dimensionBrowser', 'legacyControls.ts'))).toBe(false);
  });
});
