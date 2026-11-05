import type { ConsistencyProcess, ConsistencyRule, RawFinding, UnitKey } from '../types';
import { occurrencesOf } from '../scanText';

export const TI_KEYWORDS: readonly string[] = ['IF', 'ELSEIF', 'ELSE', 'ENDIF', 'WHILE', 'END', 'BREAK'];

export const keywordCasingRule: ConsistencyRule = {
  kind: 'keyword-casing',
  editableTarget: false,
  touchesDeclarations: false,
  minVariantsToReport: 1,
  scan(proc: ConsistencyProcess): RawFinding[] {
    const out: RawFinding[] = [];
    for (const kw of TI_KEYWORDS) {
      const keyLc = kw.toLowerCase();
      const canonical = kw;                                  // UPPER
      const bySpelling = new Map<string, RawFinding>();
      for (const u of proc.units) {
        for (const o of occurrencesOf(u.text, keyLc)) {
          if (o.spelling === canonical) { continue; }
          let rf = bySpelling.get(o.spelling);
          if (!rf) {
            rf = { key: keyLc, kind: 'keyword', spelling: o.spelling, occurrences: [], target: canonical };
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
