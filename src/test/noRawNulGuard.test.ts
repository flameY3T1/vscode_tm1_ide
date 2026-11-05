// Source guard: no raw NUL byte in a source file.
//
// A literal U+0000 makes the file "binary" for grep ("binary file matches",
// no line shown) and for the agent's edit tools, which refuse to write it.
// Found 2026-11-04 in two files that used it as a key separator. The escape
// `\u0000` yields the identical string at runtime and keeps the file text.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(p, out); } else if (/\.(ts|js|mjs|json|css|html)$/.test(entry.name)) { out.push(p); }
  }
  return out;
}

describe('no raw NUL byte in src/', () => {
  it('every source file is NUL-free (write \\u0000 instead)', () => {
    const offenders = walk(SRC)
      .filter((f) => fs.readFileSync(f).includes(0))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
