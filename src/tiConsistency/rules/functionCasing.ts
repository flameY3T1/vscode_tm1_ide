import type { ConsistencyProcess, ConsistencyRule, RawFinding, UnitKey } from '../types';
import { occurrencesOf } from '../scanText';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';

export const functionCasingRule: ConsistencyRule = {
  kind: 'function-casing',
  editableTarget: false,
  touchesDeclarations: false,
  minVariantsToReport: 1,
  scan(proc: ConsistencyProcess): RawFinding[] {
    const out: RawFinding[] = [];
    for (const [keyLc, sig] of KNOWN_SIGNATURES) {
      const canonical = sig.name;
      const bySpelling = new Map<string, RawFinding>();
      for (const u of proc.units) {
        for (const o of occurrencesOf(u.text, keyLc)) {
          if (o.spelling === canonical) { continue; }        // already correct → skip
          let rf = bySpelling.get(o.spelling);
          if (!rf) {
            rf = { key: keyLc, kind: 'function', spelling: o.spelling, occurrences: [], target: canonical };
            bySpelling.set(o.spelling, rf);
          }
          rf.occurrences.push({ process: proc.name, unit: u.key as UnitKey, line: o.line, column: o.column, length: o.length });
        }
      }
      out.push(...bySpelling.values());
    }
    return out;
  },
};
