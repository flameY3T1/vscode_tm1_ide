// Source guard: `sessionOfPanel(panel)` (formerly `_panelMeta.get(panel)`) is never dereferenced directly.
//
// `onDidDispose` deletes the entry synchronously. Any handler that reaches the
// lookup after an `await` — save after the user closed the tab, a load that
// finishes after the close — gets `undefined`. Review 2026-10-02: a successful
// deploy was reported as "Deploy failed: Cannot set properties of undefined".
// Bind the lookup to a local and check it.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.resolve(__dirname, '../../commands/processEditor');

describe('process editor: no direct _panelMeta dereference', () => {
  it('every lookup is checked before use', () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(DIR).filter(f => f.endsWith('.ts'))) {
      fs.readFileSync(path.join(DIR, name), 'utf8').split('\n').forEach((line, i) => {
        // `sessionOfPanel(panel)` replaced `_panelMeta.get(panel)`; same rule.
        if (/\((_panelMeta\.get|sessionOfPanel)\([^)]*\)(\s+as\s+\w+)?\)\.|(_panelMeta\.get|sessionOfPanel)\([^)]*\)!?\.\w/.test(line)) {
          offenders.push(`${name}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
