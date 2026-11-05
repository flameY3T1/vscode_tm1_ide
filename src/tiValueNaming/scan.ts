import type { ConsistencyProcess } from '../tiConsistency/types';
import type { Assignment, ValueGroup, ValueName } from './types';
import { collectStringAssignments } from './collect';

/** Per (process, var): keep only vars with exactly one distinct literal value; drop multi-value vars (Phase 2). */
function singleValueCandidates(processes: ConsistencyProcess[]): Assignment[] {
  const out: Assignment[] = [];
  for (const proc of processes) {
    const byVar = new Map<string, Assignment[]>();
    for (const a of collectStringAssignments(proc)) {
      const arr = byVar.get(a.varLc);
      if (arr) { arr.push(a); } else { byVar.set(a.varLc, [a]); }
    }
    for (const arr of byVar.values()) {
      const distinctValues = new Set(arr.map(a => a.value.toLowerCase()));
      // One clean literal value → keep EVERY assignment site so the group's
      // count and clickable occurrences reflect all writes in the process
      // (not just the first), e.g. sMode='Sales' on line 3 AND line 40.
      if (distinctValues.size === 1) { out.push(...arr); }
    }
  }
  return out;
}

export function scanValueGroups(processes: ConsistencyProcess[]): ValueGroup[] {
  const byValue = new Map<string, { sample: string; names: Map<string, ValueName> }>();
  for (const a of singleValueCandidates(processes)) {
    const vk = a.value.toLowerCase();
    let g = byValue.get(vk);
    if (!g) { g = { sample: a.value, names: new Map() }; byValue.set(vk, g); }
    let n = g.names.get(a.varLc);
    if (!n) { n = { name: a.varName, count: 0, occurrences: [] }; g.names.set(a.varLc, n); }
    n.count += 1;
    n.occurrences.push({ process: a.process, unit: a.unit, line: a.line });
  }
  const out: ValueGroup[] = [];
  for (const [valueKey, g] of byValue) {
    const names = [...g.names.values()].sort((x, y) => y.count - x.count);
    if (names.length < 2) { continue; } // needs >= 2 distinct names to be a divergence
    out.push({ valueKey, valueSample: g.sample, canonicalSuggestion: names[0].name, names });
  }
  return out.sort((a, b) => a.valueKey.localeCompare(b.valueKey));
}
