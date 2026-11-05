import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Guard (mirrors the noManualBodyRelease / noInlineEscape convention): forbid
// the plain-string cell coordinate in a `tm1.Update` body.
//
//   { Cells: [{ Tuple: ['SalesCube', 'Sales'] }], Value: 'WRITE' }    ← rejected
//   { Cells: [{ 'Tuple@odata.bind': [elementRef(…), …] }], Value: … } ← correct
//
// TM1 answers the first form with HTTP 400 — *"Unexpected value type
// encountered in the payload while processing \"CellDescriptor\". Expecting
// either type \"Object\" or \"EntityBind\" but was \"String\""* — which reaches
// the user as a silent "0 saved, 1 failed". All five security matrices shipped
// with it; the cube-viewer write path (`cubeViewer/cubeWriteApi.ts`) and the
// dimension editor's attribute write always used the bind form. Live-verified
// against TM1 11.8.02900.8 on 2026-07-26: string form 400, bind form 204.
const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
}

/** `Cells: [{ Tuple: [` — the rejected shape, whitespace-tolerant. */
const PLAIN_TUPLE = /Cells\s*:\s*\[\s*\{\s*Tuple\s*:/;

describe('no plain-string Tuple in tm1.Update bodies', () => {
  it('every cell-update body uses Tuple@odata.bind', () => {
    const files: string[] = [];
    walk(SRC, files);
    const offenders = files
      .filter(f => PLAIN_TUPLE.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the guard actually matches the shape it forbids', () => {
    expect(PLAIN_TUPLE.test('JSON.stringify({ Cells: [{ Tuple: [a, b] }], Value: v })')).toBe(true);
    expect(PLAIN_TUPLE.test("JSON.stringify({ Cells: [{ 'Tuple@odata.bind': [a, b] }], Value: v })")).toBe(false);
  });
});
