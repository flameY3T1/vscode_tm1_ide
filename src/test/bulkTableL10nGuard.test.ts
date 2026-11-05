// src/test/bulkTableL10nGuard.test.ts
//
// Guard: what both bulk pages call the same stands in
// `bulkTableL10n.ts` — and only there.
//
// Why a gate is needed: if a page writes out a kind name by itself again,
// NOTHING catches it. Key and value are valid on both sides,
// just different, and no test, no `tsc` and no depcruise
// compares two translation maps with each other. You would only have seen it
// from the same column being called "Views" on one page and something else
// on the other.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** The entries a map sets ITSELF — without what it spreads. */
function ownEntries(rel: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read(rel).matchAll(/^\s{4}(\w+): (vscode\.l10n\.t\(.*?\)),$/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

const shared = ownEntries('src/webviews/bulkTableL10n.ts');
const pages = [
  'src/webviews/bulkDeleteL10n.ts',
  'src/webviews/bulkDeployL10n.ts',
] as const;

describe('shared bulk texts stand in one place', () => {
  it('finds shared entries at all', () => {
    // Otherwise the spelling has changed and the guard checks nothing.
    expect(shared.size).toBeGreaterThan(20);
  });

  it.each(pages)('%s spreads the shared map', (page) => {
    expect(read(page)).toContain('...buildBulkTableL10n()');
  });

  it.each(pages)('%s does not write out a shared entry again', (page) => {
    // A DIFFERENT text under the same key is allowed — the
    // step labels are named differently on the two pages. Forbidden
    // is the word-for-word repetition: that is pure duplication and drifts
    // apart the next time.
    const dupes = [...ownEntries(page)]
      .filter(([k, v]) => shared.get(k) === v)
      .map(([k]) => k);
    expect(dupes).toEqual([]);
  });
});
