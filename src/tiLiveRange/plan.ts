import type { ConsistencyProcess, ConsistencyEdit, RenamePlan, UnitKey } from '../tiConsistency/types';
import { codeKeysOf, renameOccurrences, eqAssignCandidateLines } from '../tiConsistency/scanText';
import { analyzeVariable } from './defsAndReads';
import { computeReaching } from './reachingDefs';
import { liveRangeOf } from './liveRange';
import { combinedLineToUnit } from '../tiConsistency/unitLines';
import { isReservedName } from '../tiConsistency/reserved';

/**
 * Occurrence-scoped split plan: rename only the live range of one chosen def
 * (its write + the reads it reaches) to `newName`, leaving other defs/reads
 * of the same variable name untouched. Refuses (no edits) when the live-range
 * analysis can't cleanly attribute reads to a single def (`lr.refused`), or
 * when `newName` collides with an existing identifier in the process.
 */
export function planSplit(
  proc: ConsistencyProcess,
  varLc: string,
  defId: number,
  newName: string,
): RenamePlan {
  const combined = proc.units.map(u => u.text).join('\n');
  const a = analyzeVariable(combined, proc.params.map(p => p.name), varLc);
  if (!a) {
    return { edits: [], skipped: [{ process: proc.name, reason: 'unparseable' }] };
  }

  // Defense-in-depth: never split a reserved/system variable, even if a
  // caller (UI or otherwise) somehow requests it.
  if (isReservedName(varLc)) {
    return { edits: [], skipped: [{ process: proc.name, reason: 'reserved' }] };
  }

  // Critical guard: a physical line can hold multiple `;`-separated
  // statements, all unfolded to the SAME combined-doc line number. If the
  // chosen def shares its line with another def of the same variable, the
  // line-keyed def handling downstream can't tell them apart — splitting one
  // would silently orphan a read of the other and corrupt the process. Refuse
  // before any live-range/collision/edit logic runs.
  //
  // Belt-and-suspenders: even when the parser only sees ONE def on the line,
  // the LHS heuristic in defsAndReads.ts can mis-bind a same-line comparison
  // of the same var against a single '=' (invalid TM1 — real comparisons use
  // '@=' — but a code-mutating tool must refuse rather than corrupt).
  const def = a.defs.find(d => d.id === defId);
  if (
    def &&
    (a.defs.filter(d => d.line === def.line).length > 1 ||
      (eqAssignCandidateLines(combined, varLc).get(def.line) ?? 0) > 1)
  ) {
    return { edits: [], skipped: [{ process: proc.name, reason: 'ambiguous' }] };
  }

  const reaching = computeReaching(a.ast, varLc, a.defs, a.reads);
  const lr = liveRangeOf(a.defs, reaching, defId);
  if (lr.refused) {
    return { edits: [], skipped: [{ process: proc.name, reason: lr.refused }] };
  }

  const keys = codeKeysOf(combined);
  keys.delete(varLc);
  if (keys.has(newName.toLowerCase())) {
    return { edits: [], skipped: [{ process: proc.name, reason: 'collision' }] };
  }

  const byUnit = new Map<UnitKey, { line: number; column: number }[]>();
  for (const pos of lr.positions) {
    const { unit, line } = combinedLineToUnit(proc.units, pos.line);
    const arr = byUnit.get(unit);
    if (arr) { arr.push({ line, column: pos.column }); } else { byUnit.set(unit, [{ line, column: pos.column }]); }
  }

  const changedSections: Partial<Record<UnitKey, string>> = {};
  for (const unit of proc.units) {
    const positions = byUnit.get(unit.key);
    if (!positions || positions.length === 0) { continue; }
    changedSections[unit.key] = renameOccurrences(unit.text, positions, newName);
  }

  if (Object.keys(changedSections).length === 0) {
    return { edits: [], skipped: [] };
  }

  const edit: ConsistencyEdit = { process: proc.name, changedSections };
  return { edits: [edit], skipped: [] };
}
