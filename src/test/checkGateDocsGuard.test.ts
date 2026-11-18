import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// AGENTS.md and CONTRIBUTING.md each write out the gates of `npm run check` by
// hand. On 2026-11-15 AGENTS.md listed six of the seven (`lint:dead` missing).
// The script is the truth; both lists must name the same gates in its order.
const ROOT = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const gates = (JSON.parse(read('package.json')) as { scripts: { check: string } }).scripts.check
  .split('&&').map(s => s.trim().replace(/^npm (run )?/, ''));

describe('written gate lists follow scripts.check', () => {
  it('AGENTS.md numbers the gates in order', () => {
    const listed = [...read('AGENTS.md').matchAll(/^\d+\. `([\w:]+)`/gm)].map(m => m[1]);
    expect(listed).toEqual(gates);
  });

  it('CONTRIBUTING.md names the gates behind `npm run check`', () => {
    const line = /^npm run check\s+# (.+)$/m.exec(read('CONTRIBUTING.md'))?.[1] ?? '';
    expect(line.split(',').map(s => s.trim())).toEqual(gates);
  });
});
