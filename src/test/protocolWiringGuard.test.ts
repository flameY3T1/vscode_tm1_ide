// Source guard: every message type in a webview protocol has a sender AND a
// receiver.
//
// A "dead wire" compiles, passes every test and silently does nothing. Review
// 2026-10-02: the process editor's `monacoRequestParameters` had no client
// side, so Insert Node Ref waited 2 s on every call and never passed the
// caller's parameters through; `filterToElement` had a cube viewer handler
// nobody sent. Earlier: `_getSnippets` was built and never read.
//
// For each `src/webviewClient/<name>/protocol.ts`, the top-level members of
// `WebviewToHost` must appear in the client (sender) and in host code
// (receiver), and the reverse for `HostToWebview`. "Appears" means the quoted
// type string, or a dispatch-table key `type:` / `type(`.
//
// KNOWN is a ratchet: entries may only be removed. A new dead wire fails here.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
const CLIENT = path.join(SRC, 'webviewClient');

const KNOWN = new Set([
  // Host announces it; the client keeps no busy state to reset.
  // Declared in the union, never used by this client (tiConsole sends its own).
  'dimensionBrowser WebviewToHost fetchHierarchies no sender',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'test-integration' || entry.name === 'node_modules') { continue; }
      walk(p, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const read = (f: string): string => fs.readFileSync(f, 'utf8');

/** Top-level `{ type: '…' }` members of `export type <name> = …;`. */
function unionTypes(src: string, name: string): string[] {
  const start = src.indexOf(`export type ${name} =`);
  if (start < 0) { return []; }
  let rest = src.slice(start + `export type ${name} =`.length);
  const end = rest.search(/;\s*\n(export|\/\*\*|\/\/|interface|type |const )/);
  if (end >= 0) { rest = rest.slice(0, end); }
  return [...rest.matchAll(/(?:^|\|)\s*\{\s*type:\s*'([^']+)'/gm)].map(m => m[1]);
}

function mentions(text: string, type: string): boolean {
  return new RegExp(`['"\`]${type}['"\`]|\\b${type}\\s*:|\\b${type}\\s*\\(`).test(text);
}

describe('webview protocols have no dead wires', () => {
  it('every protocol message has a sender and a receiver', () => {
    const all = walk(SRC);
    const hostText = all.filter(f => !f.startsWith(CLIENT + path.sep)).map(read).join('\n');
    const sharedText = walk(path.join(CLIENT, '_shared')).map(read).join('\n');
    const found: string[] = [];
    for (const dir of fs.readdirSync(CLIENT)) {
      const proto = path.join(CLIENT, dir, 'protocol.ts');
      if (!fs.existsSync(proto)) { continue; }
      const src = read(proto);
      const clientText = walk(path.join(CLIENT, dir)).filter(f => f !== proto).map(read).join('\n') + sharedText;
      const sides: Array<[string, string, string]> = [
        ['WebviewToHost', clientText, hostText],
        ['HostToWebview', hostText, clientText],
      ];
      for (const [union, senderText, receiverText] of sides) {
        for (const type of new Set(unionTypes(src, union))) {
          if (!mentions(senderText, type)) { found.push(`${dir} ${union} ${type} no sender`); }
          if (!mentions(receiverText, type)) { found.push(`${dir} ${union} ${type} no receiver`); }
        }
      }
    }
    expect(found.filter(f => !KNOWN.has(f))).toEqual([]);
    // Ratchet: a fixed wire must leave KNOWN too.
    expect([...KNOWN].filter(k => !found.includes(k))).toEqual([]);
  });
});
