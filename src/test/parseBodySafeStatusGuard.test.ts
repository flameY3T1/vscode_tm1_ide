// Source guard: every `parseBodySafe(` call is preceded by a status check.
//
// `apiRequest` resolves on non-2xx. A 403/500 error body is valid JSON, so
// `parseBodySafe(res, {}).value ?? []` turns a refused request into "no
// objects". Review 2026-10-02 found this behind Find & Replace ("0 matches")
// and the consistency scan ("no findings") — the user had no way to tell.
//
// "Status check" means `statusCode`, `assertOk` or an `.ok` test within the
// preceding lines. Where an empty answer IS the intended fallback, add the
// site to ALLOWED with the reason.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
const WINDOW = 14;

const ALLOWED: Record<string, string> = {
  // Best-effort server name; any failure falls through to the admin-server list.
  'commands/tm1Top.ts': 'discoveredName fallback',
  // Suppress flags of a saved view; the two sibling requests carry the status checks.
  'commands/cubeViewer/fetch.ts': 'view suppress flags',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'test-integration' || entry.name === 'node_modules') { continue; }
      walk(p, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('parseBodySafe is preceded by a status check', () => {
  it('no unchecked call site outside the allow list', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (rel === 'tm1Rest/parseRest.ts') { continue; }
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bparseBodySafe\s*[<(]/.test(line) || /^\s*(import|\*|\/\/)/.test(line)) { return; }
        const before = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n');
        if (/statusCode|assertOk|isOk\(|\.ok\b/.test(before)) { return; }
        if (ALLOWED[rel]) { return; }
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
