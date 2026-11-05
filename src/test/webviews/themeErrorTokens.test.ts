import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Guard for the theme-token pairing rule (mirrors the noManualBodyRelease /
// noNativeDialogs source-scan convention).
//
// Background: `inputValidation.errorForeground` has a built-in default of `null`
// for BOTH dark and light (monaco-editor .../colors/inputColors.js — only
// `hcLight` sets it), so VS Code emits NO CSS variable for it in Dark+/Light+.
// Whatever fallback the declaration carries is what actually renders. Two ways
// to get that wrong, both previously shipped:
//   1. a hardcoded fallback that only works in one theme
//      (`var(--vscode-inputValidation-errorForeground, #fff)` rendered white on
//      #F2DEDE in every light theme), or no fallback at all → inherited colour;
//   2. crossing the token families: `--vscode-errorForeground` (a standalone
//      accent colour meant for text on the normal editor background) painted on
//      `--vscode-inputValidation-errorBackground`.
// The house style is the pair
// `var(--vscode-inputValidation-errorForeground, var(--vscode-foreground))`.

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === 'test-integration') { continue; }
      walk(p, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SRC).map(f => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));

const TOKEN = 'var(--vscode-inputValidation-errorForeground';
const GOOD = 'var(--vscode-inputValidation-errorForeground, var(--vscode-foreground))';

describe('theme error-token pairs', () => {
  it('scans a plausible number of source files', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('never uses inputValidation-errorForeground without the editor-foreground fallback', () => {
    const hits: string[] = [];
    for (const { file, text } of FILES) {
      text.split('\n').forEach((line, i) => {
        let idx = line.indexOf(TOKEN);
        while (idx >= 0) {
          if (!line.startsWith(GOOD, idx)) { hits.push(`${file}:${i + 1}: ${line.trim()}`); }
          idx = line.indexOf(TOKEN, idx + 1);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('never paints the standalone errorForeground on an inputValidation error background', () => {
    const hits: string[] = [];
    for (const { file, text } of FILES) {
      text.split('\n').forEach((line, i) => {
        const crossPair = /color:\s*var\(--vscode-errorForeground[^;]*;/.test(line)
          && line.includes('--vscode-inputValidation-errorBackground');
        if (crossPair) { hits.push(`${file}:${i + 1}: ${line.trim()}`); }
      });
    }
    expect(hits).toEqual([]);
  });
});
