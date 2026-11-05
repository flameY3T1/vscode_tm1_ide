import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard: no native `confirm()` / `alert()` / `prompt()` in webview clients.
 *
 * VS Code webviews run in a sandboxed iframe where the three native modal
 * dialogs are disabled: the call returns immediately with a falsy value and
 * shows nothing. A `if (confirm(...)) { … }` therefore never runs its body
 * (dead button), and an `alert(...)` is swallowed entirely (no feedback).
 * `dimensionEditor/modals.ts` exists precisely because of that; the reusable
 * replacement is `_shared/confirmDialog.ts` plus inline in-page error text.
 *
 * The Monaco bundles cannot be imported in a unit test, so this scans the
 * sources — same approach as `noManualBodyRelease.test.ts`.
 */
const CLIENT_ROOT = path.resolve(__dirname, '../../webviewClient');

/** Strip block and line comments so doc comments naming `confirm()` don't trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** Bare `confirm(` / qualified `window.confirm(` — but not `askConfirm(`, `foo.confirm(`. */
const BARE = /(?<![\w$.])(confirm|alert|prompt)\s*\(/;
const QUALIFIED = /\b(?:window|globalThis|self)\s*\.\s*(?:confirm|alert|prompt)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); }
    else if (entry.name.endsWith('.ts')) { out.push(full); }
  }
  return out;
}

describe('webview clients use no native modal dialogs', () => {
  it('has no confirm()/alert()/prompt() call under src/webviewClient/**', () => {
    const hits: string[] = [];
    for (const file of walk(CLIENT_ROOT)) {
      const rel = path.relative(CLIENT_ROOT, file);
      stripComments(fs.readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (BARE.test(line) || QUALIFIED.test(line)) {
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(
      hits,
      'confirm()/alert()/prompt() are blocked in VS Code webviews — use _shared/confirmDialog.ts or inline error text',
    ).toEqual([]);
  });
});
