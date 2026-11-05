import type { UnitKey } from '../tiConsistency/types';

export interface Assignment {
  process: string;
  varName: string; // original spelling
  varLc: string; // lowercase key
  value: string; // decoded string-literal value (no surrounding quotes)
  unit: UnitKey;
  line: number; // 1-based, SECTION-RELATIVE (within `unit`), not combined-doc line
}
export interface ValueName {
  name: string; // representative original spelling
  count: number; // number processes name value
  occurrences: { process: string; unit: UnitKey; line: number }[];
}
export interface ValueGroup {
  valueKey: string; // value.toLowerCase()
  valueSample: string; // representative original-cased value (for display)
  canonicalSuggestion: string;
  names: ValueName[]; // >= 2 distinct (by lowercase), sorted by count desc
}
