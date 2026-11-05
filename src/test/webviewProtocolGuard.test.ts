import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Source scan for the host <-> webview message protocol (review A9, 2026-10-04).
 *
 * `vscode.Webview.postMessage(message: any)` accepts anything, so a renamed
 * message `type` used to be a grep, not a compile error. Host code therefore
 * posts only through `postTo<Union>(webview, msg)` (webviews/typedPost.ts),
 * where `Union` is the webview's protocol type, and webview bundles obtain
 * their API handle only through `_shared/vscodeApi.ts` (typed by the outbound
 * union, acquired once).
 *
 * RATCHET: files that may still post raw. Empty since the A9 pass; a file
 * here must also still contain a raw post (the list may only shrink).
 */
const RAW_POST_ALLOWED: Record<string, number> = {};

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { return walk(full); }
    return full.endsWith('.ts') ? [full] : [];
  });
}

const rel = (f: string): string => relative(SRC, f).split('\\').join('/');

/** Code lines only: a mention in a line or block comment is not a call. */
function codeLines(src: string): string[] {
  return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

const HOST_FILES = walk(SRC).filter(f => !/^(webviewClient|test|test-integration)\//.test(rel(f)));
const CLIENT_FILES = walk(join(SRC, 'webviewClient'));

describe('webview protocol guard', () => {
  it('host code posts only through the typed postTo helper', () => {
    const counts: Record<string, number> = {};
    for (const file of HOST_FILES) {
      const n = codeLines(readFileSync(file, 'utf8'))
        .filter(l => /\bwebview\??\.postMessage\(/.test(l)).length;
      if (n > 0) { counts[rel(file)] = n; }
    }
    expect(counts).toEqual(RAW_POST_ALLOWED);
  });

  it('postTo is never typed with any/unknown', () => {
    const offenders = HOST_FILES
      .filter(f => /postTo<\s*(any|unknown)\s*>/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('webview bundles acquire the VS Code API only in _shared/vscodeApi.ts', () => {
    const offenders = CLIENT_FILES
      .filter(f => rel(f) !== 'webviewClient/_shared/vscodeApi.ts')
      .filter(f => codeLines(readFileSync(f, 'utf8')).some(l => /\bacquireVsCodeApi\b/.test(l)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
