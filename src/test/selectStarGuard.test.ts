// Source guard: no `$select=*` against the TM1 REST API.
//
// Measured live on 11.8 on 2026-08-29: the star TRUNCATES complex types to their
// discriminator field. `Processes('x')?$select=*` returns `DataSource: {Type:
// 'ASCII'}` — without `asciiDelimiterChar`, without file names —, whereas a bare
// `GET` returns the same DataSource in full. So the star is not
// "everything", but less than the default projection.
//
// Exactly that broke "Save as…": the editor loaded the form from a
// truncated DataSource, and the POST of the copy came out without a delimiter:
//   400 "Delimiter character must be supplied when changing process data source
//        type to \"Character\""
//
// The star is tempting because `UIData` and `VariablesUIData` lie outside the
// default projection and a bare GET does NOT bring them along — so you
// need a `$select` anyway and then reach for the star. The right thing is the
// spelled-out field list (`PROCESS_FULL_SELECT` in `tm1Rest/processApi.ts`),
// which returns both.
//
// The error does not hurt on reading — it only shows up on writing back,
// one layer and several clicks away. Hence a scan instead of a unit test.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

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

/** Strips line and block comments so the warnings above do not trip the scan. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('$select=* guard', () => {
  it('no module asks TM1 for a star projection', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (/\$select=\*/.test(line) || /select:\s*['"`]\*/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the process select names every property, DataSource included', async () => {
    const { PROCESS_FULL_SELECT } = await import('../tm1Rest/processApi');
    for (const field of [
      'Name', 'HasSecurityAccess',
      'PrologProcedure', 'MetadataProcedure', 'DataProcedure', 'EpilogProcedure',
      'DataSource', 'Parameters', 'Variables', 'Attributes',
      // The two undeclared ones — the whole reason an explicit select exists.
      'VariablesUIData', 'UIData',
    ]) {
      expect(PROCESS_FULL_SELECT.split(',')).toContain(field);
    }
  });
});
