// Guard: every bundle that a webview host loads is also built.
//
// The bundle name appears twice: as a string in the host
// (`joinPath(extensionUri, 'out', 'webview', 'bulkDeploy.js')`) and as a
// key in `esbuild.config.mjs`. If the entry disappears or the host misspells
// it, the page stays EMPTY — the CSP swallows the missing script without a
// message, and no gate catches it: `tsc` sees a string, `depcruise` sees no
// dependency.
//
// The check runs against the BUILD OUTPUT, not against the configuration file.
// Two reasons: the vendor bundle `monaco-vendor` hangs off a second esbuild
// run (`vendorBuild`), so in a comparison against `editorBuild.entryPoints` it
// would wrongly show up as an error — and only the build output answers the
// question the user is asking: is the file there when the page fetches it.
// So the test needs a built `out/`, just like `addServerBundleWiring.test.ts`;
// that is why `npm run check` runs `compile` BEFORE `test`.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'out', 'webview');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'test-integration') { continue; }
      sourceFiles(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Both spellings: the split-up `joinPath` form and the whole path. */
const JOIN_PATH = /'out'\s*,\s*'webview'\s*,\s*'([^']+)\.js'/g;
const PLAIN_PATH = /out\/webview\/([A-Za-z0-9_-]+)\.js/g;

function referencedBundles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [JOIN_PATH, PLAIN_PATH]) {
      for (const m of src.matchAll(re)) {
        if (!found.has(m[1])) { found.set(m[1], path.relative(ROOT, file)); }
      }
    }
  }
  return found;
}

describe('Webview bundles: loaded ↔ built', () => {
  it('finds any bundle references at all', () => {
    // Otherwise the spelling has changed and the guard checks nothing.
    expect(referencedBundles().size).toBeGreaterThan(20);
  });

  it('builds every bundle that a host loads', () => {
    expect(fs.existsSync(OUT)).toBe(true);
    const missing = [...referencedBundles()]
      .filter(([name]) => !fs.existsSync(path.join(OUT, `${name}.js`)))
      .map(([name, file]) => `${name}.js (${file})`)
      .sort();
    expect(missing).toEqual([]);
  });
});
