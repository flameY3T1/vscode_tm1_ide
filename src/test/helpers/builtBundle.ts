// src/test/helpers/builtBundle.ts
//
// Read a built webview bundle from out/webview/ for tests that run it in a
// node:vm context. A missing or stale bundle fails loudly: a test that quietly
// ran yesterday's build would claim today's state.
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../..');

/** `name` = esbuild entry name; `sources` = repo-relative files the bundle is built from. */
export function readBuiltBundle(name: string, sources: string[]): string {
  const bundle = join(ROOT, 'out/webview', name + '.js');
  if (!existsSync(bundle)) {
    throw new Error(`Built webview bundle missing: ${bundle}\nRun \`npm run compile\` first.`);
  }
  const built = statSync(bundle).mtimeMs;
  const stale = sources.map((p) => join(ROOT, p)).filter((p) => existsSync(p) && statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`Bundle ${bundle} is older than:\n  ${stale.join('\n  ')}\nRun \`npm run compile\`.`);
  }
  return readFileSync(bundle, 'utf8');
}
