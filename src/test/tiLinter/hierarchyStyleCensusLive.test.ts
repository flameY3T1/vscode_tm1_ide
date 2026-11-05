/**
 * False-positive risk of the rule `hierarchy-style-mixed` on the real model.
 *
 * Not a gate — runs only when `CENSUS_IN` points to a process store that
 * hierarchyStyleCensusProbe.js fetched from the server beforehand.
 * Skipped without the file, so that `npm test` runs through without a server connection.
 *
 *   hierarchyStyleCensusProbe.js
 *   CENSUS_IN=/tmp/hierarchyStyleCensus.json npx vitest run \
 *     src/test/tiLinter/hierarchyStyleCensusLive.test.ts
 *
 * The result ends up next to the input as `<datei>.out.json` — vitest swallows
 * `console.log` in the default run.
 *
 * Measurement 2026-09-01 (332 processes of the test instance): 27 mixed processes with
 * 250 findings, ALL from `}bedrock.*`; zero in the customer part. The first
 * version stood at 33/321 and 51 customer findings — all of them without exception were
 * `ElementAttrInsert(x, x, …)`, i.e. the default hierarchy in long form, and
 * forced `addressesDefaultHierarchy`.
 */
import { describe, it } from 'vitest';
import * as fs from 'node:fs';
import { censusHierarchyStyle, isBedrockObject } from '../../tiLogicVisualizer/tiLinter/hierarchyStylePure';

interface LiveProcess { name: string; prolog: string; metadata: string; data: string; epilog: string }

const FILE = process.env.CENSUS_IN ?? '';

describe.skipIf(!FILE || !fs.existsSync(FILE))('Falschmeldungsrisiko am echten Modell', () => {
  it('counts mixtures, findings and triggers', () => {
    const procs: LiveProcess[] = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    let mixed = 0, legacyOnly = 0, modernOnly = 0, clean = 0, hits = 0;
    const perProcess: Array<[string, number]> = [];
    const byName = new Map<string, number>();
    const kinds = new Map<string, number>();
    const trigger = new Map<string, string>();

    for (const p of procs) {
      const c = censusHierarchyStyle([p.prolog, p.metadata, p.data, p.epilog].join('\n'));
      if (c.modernCount > 0 && c.legacy.length > 0) {
        mixed++; hits += c.legacy.length;
        perProcess.push([p.name, c.legacy.length]);
        trigger.set(p.name, c.modernSample ?? '?');
        for (const h of c.legacy) {
          byName.set(h.name, (byName.get(h.name) ?? 0) + 1);
          kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
        }
      } else if (c.legacy.length > 0) { legacyOnly++; }
      else if (c.modernCount > 0) { modernOnly++; }
      else { clean++; }
    }
    perProcess.sort((a, b) => b[1] - a[1]);
    // Bedrock is exempt from the rule — the interesting number is the rest.
    const eigene = perProcess.filter(([n]) => !isBedrockObject(n));

    fs.writeFileSync(FILE + '.out.json', JSON.stringify({
      prozesse: procs.length,
      gemischt: mixed, nurDimensionsform: legacyOnly, nurHierarchieform: modernOnly, ohneBezug: clean,
      befunde: hits,
      gemischtOhneBedrock: eigene.length,
      befundeOhneBedrock: eigene.reduce((a, [, k]) => a + k, 0),
      arten: Object.fromEntries(kinds),
      lauteste: perProcess.slice(0, 15),
      eigeneProzesse: eigene,
      ausloeser: Object.fromEntries([...trigger].filter(([n]) => !isBedrockObject(n))),
      nachFunktion: Object.fromEntries([...byName].sort((a, b) => b[1] - a[1]).slice(0, 20)),
    }, null, 2));
  });
});
