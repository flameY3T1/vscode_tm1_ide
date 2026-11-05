// Source guard: every `/$count` call must carry `$format=text/plain`.
//
// The transport hard-sets `Accept: application/json` (transport/auth.ts), and
// TM1 answers `/$count` exclusively with `text/plain` — a bare call
// therefore ALWAYS ends in `400 Code 278 "No acceptable mime type specified"`.
//
// Measured live on 11.8 on 2026-08-02: three of the four callers carried the bug
// silently (they fell back to a more expensive second query), the fourth
// (`healthCollector#fetchSessionCount`) has no fallback and returned
// -1 permanently — the session count of Server Health was never populated.
//
// This is a trap every new caller falls into, because it does not hurt:
// the fallback catches it. Hence a scan instead of a unit test.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') { continue; }
      walk(p, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** `/$count` in a string/template literal that goes to a request. */
const COUNT_CALL = /['"`][^'"`]*\/\$count(\?[^'"`]*)?['"`]/g;

describe('$count calls carry $format=text/plain', () => {
  it('no bare /$count in production code', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // Comment lines explain the quirk and may name it.
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) { return; }
        for (const m of line.matchAll(COUNT_CALL)) {
          if (!m[0].includes('$format=text/plain')) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}  ${code.slice(0, 100)}`);
          }
        }
      });
    }
    expect(offenders, `Nackte /$count-Aufrufe (TM1 antwortet 400 Code 278):\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the guard finds a planted violation', () => {
    // Proof of sharpness: the same check on a constructed snippet.
    const bad = "const res = await apiRequest('GET', `${base}/Elements/$count`, undefined, 0, cfg);";
    const hits = [...bad.matchAll(COUNT_CALL)].filter((m) => !m[0].includes('$format=text/plain'));
    expect(hits).toHaveLength(1);

    const good = "const res = await apiRequest('GET', `${base}/Elements/$count?$format=text/plain`, undefined, 0, cfg);";
    const none = [...good.matchAll(COUNT_CALL)].filter((m) => !m[0].includes('$format=text/plain'));
    expect(none).toHaveLength(0);
  });
});
