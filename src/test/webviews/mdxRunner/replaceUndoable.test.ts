import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard: replacing the MDX runner's content must stay undoable.
 *
 * `editor.setValue` clears Monaco's undo stack (`_setValueFromTextBuffer` calls
 * `_commandManager.clear()`), so Clear, a picked history entry, a starter snippet
 * or an MDX handed over from another panel could not be taken back with Ctrl+Z.
 * All four go through `replaceAll()`, which wraps one `executeEdits` in undo stops
 * — same fix as the rule editor's element qualifier.
 *
 * The client is a Monaco bundle that cannot be imported in a unit test, so this
 * scans the source — same approach as `noManualBodyRelease.test.ts`.
 */
const SRC = path.resolve(__dirname, '../../../webviewClient/mdxRunnerMonaco/index.ts');

function source(): string {
  return fs.readFileSync(SRC, 'utf8');
}

describe('mdx runner: replacing the editor content stays undoable', () => {
  it('has no setValue call left on the editor or its model', () => {
    const hits = source()
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(l => /\b(editor|model)\.setValue\s*\(/.test(l.text));
    expect(hits, 'setValue clears the undo stack — use replaceAll()').toEqual([]);
  });

  it('replaceAll wraps a single executeEdits in undo stops', () => {
    const text = source();
    const start = text.indexOf('function replaceAll');
    expect(start, 'replaceAll() helper not found').toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('\n}', start));
    expect(body).toMatch(/pushUndoStop\s*\(\)[\s\S]*executeEdits\s*\([\s\S]*pushUndoStop\s*\(\)/);
    expect(body).toMatch(/getFullModelRange\s*\(\)/);
  });

  it('routes clear, history, snippet and loadMdx through replaceAll', () => {
    const text = source();
    const calls = text.match(/replaceAll\s*\(/g) ?? [];
    // one declaration plus the four replacement sites
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});
