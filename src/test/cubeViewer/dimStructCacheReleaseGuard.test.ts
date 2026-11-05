import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The structure cache holds level and parent maps beyond the lifetime of a
 * refresh — for `Konten`, three maps over 160,659 entries. As long as a
 * Cube Viewer is open, that is the purpose. Once the last one is closed, it is only
 * held memory that nobody fetches any more.
 *
 * A real test for this would need the complete panel dummy (this
 * subsystem has none); so, as with `countFormatGuard` /
 * `viewColumnDeliberateGuard`, it is checked at the source that both teardown paths
 * release the cache.
 */
const SRC = readFileSync(join(process.cwd(), 'src/commands/cubeViewer/manager.ts'), 'utf8');

/** Body of a function/callback from `startIdx` via bracket counting. */
function blockAfter(src: string, startIdx: number): string {
  const open = src.indexOf('{', startIdx);
  if (open < 0) { return ''; }
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(open, i + 1); } }
  }
  return '';
}

describe('Cube Viewer releases the structure cache', () => {
  it('imports the release at all', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*invalidateDimStructure[^}]*\}\s*from\s*'\.\/dimStructCache'/);
  });

  it('releases when the LAST panel is closed, not on every one', () => {
    const body = blockAfter(SRC, SRC.indexOf('panel.onDidDispose('));
    expect(body).not.toBe('');
    expect(body).toContain('invalidateDimStructure()');
    // Bound to the condition: closing a panel while a second one is on
    // the same dimension must not make that one's next click more expensive.
    expect(body).toMatch(/_panels\.size\s*===\s*0/);
  });

  it('also releases when all panels are cleared away', () => {
    const body = blockAfter(SRC, SRC.indexOf('static disposeAll('));
    expect(body).not.toBe('');
    expect(body).toContain('invalidateDimStructure()');
  });
});
