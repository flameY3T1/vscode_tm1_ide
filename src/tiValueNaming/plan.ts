import type { ConsistencyProcess, RenamePlan, UnitKey } from '../tiConsistency/types';
import { codeKeysOf, renameIdentifier } from '../tiConsistency/scanText';
import { collectStringAssignments } from './collect';

/** Whole-word identifier tokens present in process code (strings/comments masked). */
function codeKeys(proc: ConsistencyProcess): Set<string> {
  return codeKeysOf(proc.units.map(u => u.text).join('\n'));
}

export function planNameUnify(
  valueKey: string,
  canonical: string,
  processes: ConsistencyProcess[],
  namesToRename?: string[],
): RenamePlan {
  const edits: RenamePlan['edits'] = [];
  const skipped: RenamePlan['skipped'] = [];
  const canonLc = canonical.toLowerCase();
  const valueKeyLc = valueKey.toLowerCase();
  // Per-name opt-out: when provided, only these variable names (lowercased) are
  // folded into the canonical; unchecked names stay as-is. Undefined = fold all
  // (backward-compatible default). Applied BEFORE the merge-refusal check, so
  // unchecking one of two same-value vars in a process makes the remaining
  // single rename safe instead of a refused merge.
  const renameSet = namesToRename ? new Set(namesToRename.map(n => n.toLowerCase())) : undefined;

  for (const proc of processes) {
    // single-value string vars in this process carrying the target value?
    const byVar = new Map<string, Set<string>>(); // varLc -> distinct values (lowercased)
    for (const a of collectStringAssignments(proc)) {
      let set = byVar.get(a.varLc);
      if (!set) { set = new Set(); byVar.set(a.varLc, set); }
      set.add(a.value.toLowerCase());
    }

    // candidates: single-value string vars whose sole value is the target, excluding the canonical name itself
    const candidates: string[] = [];
    for (const [varLc, values] of byVar) {
      if (values.size !== 1 || !values.has(valueKeyLc)) { continue; } // single value == target
      if (varLc === canonLc) { continue; } // already canonical
      if (renameSet && !renameSet.has(varLc)) { continue; } // user unchecked this name
      candidates.push(varLc);
    }

    if (candidates.length === 0) { continue; } // nothing to rename in this process

    // collision-guard: canonical is a DIFFERENT existing identifier in this process
    const keys = codeKeys(proc);
    if (keys.has(canonLc)) {
      skipped.push({ process: proc.name, reason: `target '${canonical}' already used in ${proc.name}` });
      continue;
    }

    if (candidates.length > 1) {
      // refuse to merge distinct variables into one canonical name
      skipped.push({
        process: proc.name,
        reason: `renaming to '${canonical}' would merge ${candidates.length} variables in ${proc.name}`,
      });
      continue;
    }

    const varLc = candidates[0];
    const changedSections: Partial<Record<UnitKey, string>> = {};
    for (const unit of proc.units) {
      const renamed = renameIdentifier(unit.text, varLc, canonical);
      if (renamed !== unit.text) { changedSections[unit.key] = renamed; }
    }
    if (Object.keys(changedSections).length > 0) {
      edits.push({ process: proc.name, changedSections });
    }
  }

  return { edits, skipped };
}
