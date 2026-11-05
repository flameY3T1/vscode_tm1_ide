// Guard: every registered command stands in the manifest, and every command
// in the manifest is registered.
//
// The bug this catches occurred on 2026-09-19 and cost half of the
// extension: a broken activation skipped the chore, cube,
// dimension, security and language registrations, visible as
//   command 'tm1.cubeOverview' not found
// (fixed in `740db81c`). A menu entry pointing at a never-registered command
// produces the same message, just without a cause in front of it.
//
// No other gate sees this: `tsc` does not know `package.json`, and a
// manifest with a surplus entry is syntactically flawless. The
// bug only shows up on a click on exactly this entry.
//
// The comparison is mechanically possible because ALL registrations write the id
// as a string — measured 2026-09-20: 183 literals, 0 dynamic ones.
// If a dynamic one were added (`registerCommand(id, …)` with a variable),
// the first test reports it, instead of silently tearing a hole into the comparison.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/**
 * `tm1.internal.*` deliberately does NOT belong in the manifest: these commands are
 * jump targets for our own webviews, not an entry in the Command Palette.
 */
const INTERNAL_PREFIX = 'tm1.internal.';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // `test`/`test-integration` register nothing, they mock.
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'test-integration') { continue; }
      sourceFiles(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const REGISTER = /register(?:TextEditor)?Command\(\s*([^,)]{0,90})/g;

function scanRegistrations(): { ids: Set<string>; dynamic: string[] } {
  const ids = new Set<string>();
  const dynamic: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(REGISTER)) {
      const arg = m[1].trim();
      if (/^['"]/.test(arg)) { ids.add(arg.slice(1, -1)); }
      else { dynamic.push(`${path.relative(ROOT, file)}: ${arg}`); }
    }
  }
  return { ids, dynamic };
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as {
  contributes: {
    commands: Array<{ command: string }>;
    menus?: Record<string, Array<{ command?: string }>>;
  };
};

const declared = new Set(manifest.contributes.commands.map(c => c.command));
const { ids: registered, dynamic } = scanRegistrations();

describe('contributes.commands ↔ registerCommand', () => {
  it('writes every command id as a string', () => {
    // Otherwise the comparison below no longer holds, without anyone noticing.
    expect(dynamic).toEqual([]);
  });

  it('registers every command that stands in the manifest', () => {
    expect([...declared].filter(c => !registered.has(c)).sort()).toEqual([]);
  });

  it('declares every registered command in the manifest — except the internal ones', () => {
    const missing = [...registered]
      .filter(c => !declared.has(c) && !c.startsWith(INTERNAL_PREFIX))
      .sort();
    expect(missing).toEqual([]);
  });

  it('binds every menu entry to a declared command', () => {
    // A menu entry on an id that `contributes.commands` does not know
    // appears without a label and throws on click.
    const orphans: string[] = [];
    for (const [menu, items] of Object.entries(manifest.contributes.menus ?? {})) {
      for (const item of items) {
        if (item.command && !declared.has(item.command)) {
          orphans.push(`${menu}: ${item.command}`);
        }
      }
    }
    expect(orphans.sort()).toEqual([]);
  });
});
