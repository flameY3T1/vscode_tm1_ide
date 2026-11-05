import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `KNOWN_SIGNATURES` is EMPTY in the webview at load time. The map is filled
 * solely by `_shared/sigsBootstrap`, which reads the block
 * `#tm1-signatures-data` embedded by the host.
 *
 * Whoever uses the map without wiring up both gets no crash but SILENCE: no
 * suggestions, no explanation popup, no colored function names — an empty map
 * looks like a map without hits. That is exactly how the TI console was
 * shipped on 2026-09-18, and that is exactly why this guard is here.
 */

const ROOT = path.resolve(__dirname, '../..');
const BOOTSTRAP = '_shared/sigsBootstrap';
/** The home of the map — an access there is not a consumer. */
const SIGS_HOME = 'src/tiLogicVisualizer/';

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** All entry points, the way esbuild builds them. */
function entryPoints(): string[] {
  const cfg = read('esbuild.config.mjs');
  const out: string[] = [];
  const re = /'(src\/webviewClient\/[^']+\/index\.ts)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg)) !== null) { out.push(m[1]); }
  return [...new Set(out)];
}

/**
 * Relative imports of a file, resolved to paths — WITHOUT `import type`.
 *
 * A pure type import disappears during the build; following it pulls modules
 * into the calculation that never end up in the bundle. That way the dimension
 * editor hangs on `references/referenceIndex.ts` via two type lines and thus
 * looked like a consumer of the function list.
 */
function localImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /import\s+(type\s+)?[\s\S]*?from\s+'(\.[^']+)'|import\s+'(\.[^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) { continue; }
    const spec = m[2] ?? m[3];
    const abs = path.resolve(path.dirname(file), spec);
    for (const cand of [`${abs}.ts`, path.join(abs, 'index.ts')]) {
      if (fs.existsSync(cand)) { out.push(cand); break; }
    }
  }
  return out;
}

/**
 * Does the entry point REALLY read the map anywhere?
 *
 * What is searched for is the dot access (`KNOWN_SIGNATURES.values()`), not the
 * bare name: a module that only imports the type `TiKnownSignature` or mentions
 * the name in a comment needs no bootstrap. The file of origin itself is left
 * out — that is where the map lives, and that is where it is filled.
 */
function readsSignatures(entry: string): boolean {
  const seen = new Set<string>();
  const stack = [path.join(ROOT, entry)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) { continue; }
    seen.add(file);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (!rel.startsWith(SIGS_HOME) && /KNOWN_SIGNATURES\s*\./.test(fs.readFileSync(file, 'utf8'))) {
      return true;
    }
    stack.push(...localImports(file));
  }
  return false;
}

describe('sigsBootstrap — whoever uses the function list must also fill it', () => {
  const entries = entryPoints();

  it('finds any entry points at all', () => {
    // Without this, a scan that finds nothing could not be told apart from a
    // broken scan.
    expect(entries.length).toBeGreaterThan(10);
  });

  it('every client that accesses KNOWN_SIGNATURES loads sigsBootstrap', () => {
    const ohne = entries
      .filter(e => readsSignatures(e))
      .filter(e => !read(e).includes(BOOTSTRAP));
    expect(
      ohne,
      'Webview-Eintragspunkt benutzt `KNOWN_SIGNATURES`, laedt aber\n'
      + `\`${BOOTSTRAP}\` nicht. Die Karte bleibt leer — es gibt keine\n`
      + 'Fehlermeldung, nur fehlende Vorschlaege. Bootstrap als ERSTEN Import\n'
      + `ergaenzen:\n${ohne.join('\n')}`,
    ).toEqual([]);
  });

  it('the host embeds the function list where the client expects it', () => {
    // The other side: a bootstrap without embedded JSON only reports on the
    // webview console and stays invisible in operation.
    const hosts = [
      'src/commands/processEditor/processEditorMonacoWebview.ts',
      'src/commands/rule/ruleEditorMonacoWebview.ts',
      'src/webviews/tiConsoleWebview.ts',
      'src/processTemplates/processTemplateEditorWebview.ts',
    ];
    for (const h of hosts) {
      expect(read(h), `${h} bettet \`tm1-signatures-data\` nicht ein`)
        .toContain("id: 'tm1-signatures-data'");
    }
  });
});
