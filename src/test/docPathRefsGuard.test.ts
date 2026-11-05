import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { basename, join } from 'path';

/**
 * Backtick file references in CLAUDE.md, src/**\/CLAUDE.md and
 * docs/architecture/*.md must point at a tracked file. 2026-10-04 there were 59
 * dead ones in 15 documents; 2026-10-05 all fixed, so the guard expects none.
 * Counted: `name.ts`, `dir/name.md#anchor`, … — anything with a file extension;
 * patterns with `{` or `*` are skipped. A bare name passes if any tracked file
 * has that base name. Not dead: absolute paths (`/tmp/...`), `node_modules/...`
 * and paths git ignores on purpose (`out/` build output, local
 * `docs/superpowers/` notes) — the repo never tracks those, so they cannot rot
 * here. node_modules is matched by prefix, not by check-ignore: in a worktree it
 * is a symlink, and a path beyond it makes `check-ignore --stdin` abort.
 * A module that is gone is named without its extension (`listState`).
 */

const ROOT = join(__dirname, '../..');
const REF = /`([\w./,-]+\.(?:ts|js|mjs|cjs|json|md))(?:[#:][^`]*)?`/g;

describe('doc path references', () => {
  it('no document holds a dead file reference', () => {
    const tracked = execSync('git ls-files', { cwd: ROOT }).toString().split('\n').filter(Boolean);
    const files = new Set(tracked);
    const bases = new Set(tracked.map(f => basename(f)));
    // CLAUDE.md files and docs/architecture/ are private notes, gitignored for
    // the public repo: read them only where they are tracked.
    const docs = tracked.filter(f => /^(src\/.*\/)?CLAUDE\.md$/.test(f) || /^docs\/architecture\/.*\.md$/.test(f));
    const dead: Record<string, string[]> = {};
    for (const doc of docs) {
      for (const m of readFileSync(join(ROOT, doc), 'utf8').matchAll(REF)) {
        const r = m[1];
        const ok = (files.has(r) && !(doc.startsWith('docs/') && r.startsWith('scripts/live/'))) || files.has(`src/${r}`) || files.has(`docs/architecture/${r}`)
          || (!r.includes('/') && bases.has(r)) || tracked.some(f => f.endsWith(`/${r}`));
        if (!ok && !/^(\/|node_modules\/)/.test(r)) { (dead[doc] ??= []).push(r); }
      }
    }
    // check-ignore exits 1 when nothing matches, so read stdout, not the exit code.
    const ignored = new Set(spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: ROOT, input: [...new Set(Object.values(dead).flat())].map(r => r + '\n').join(''),
    }).stdout.toString().split('\n').filter(Boolean));
    const real = Object.entries(dead)
      // A probe in scripts/live/ is ignored too, yet the public repo will not
      // have it: from docs/architecture/ such a reference is always dead.
      .map(([doc, refs]) => `${doc}: ${[...new Set(refs)].filter(r => !ignored.has(r) || (doc.startsWith('docs/') && r.startsWith('scripts/live/'))).join(', ')}`)
      .filter(line => !line.endsWith(': '));
    expect(real, 'Dead file reference — point it at the file that holds the code now, or drop the extension if the module is gone.').toEqual([]);
  });
});
