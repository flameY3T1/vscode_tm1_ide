import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Source scan: a webview module must obtain the VS Code API by IMPORTING the
 * binding that holds `acquireVsCodeApi()`, never by declaring a global.
 *
 * `declare const vscode: {...}` type-checks, lints and bundles without a word of
 * complaint — and then throws `ReferenceError: vscode is not defined` at
 * runtime, because esbuild renames the real binding (`var S = acquireVsCodeApi()`)
 * and leaves the undeclared reference as a bare global lookup. It cost a whole
 * VSIX: the process editor silently stopped marking itself dirty.
 *
 * Only the modules that actually CALL `acquireVsCodeApi()` may declare it.
 */

const ROOT = join(__dirname, '..', 'webviewClient');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { return walk(full); }
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('webview VS Code API binding', () => {
  it('declares no global `vscode` outside the modules that acquire it', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, 'utf8');
      if (!/declare const vscode\b/.test(src)) { continue; }
      // Legitimate only where the API is actually acquired in the same file.
      if (src.includes('acquireVsCodeApi')) { continue; }
      offenders.push(file.slice(file.indexOf('webviewClient')));
    }
    expect(offenders).toEqual([]);
  });
});
