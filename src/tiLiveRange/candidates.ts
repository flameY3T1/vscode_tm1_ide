import type { ConsistencyProcess } from '../tiConsistency/types';
import type { TiStatement } from '../tiLogicVisualizer/types';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { isReservedName } from '../tiConsistency/reserved';
import { combinedLineToUnit } from '../tiConsistency/unitLines';
import { analyzeVariable } from './defsAndReads';
import { eqAssignCandidateLines } from '../tiConsistency/scanText';
import { computeReaching } from './reachingDefs';
import { liveRangeOf } from './liveRange';
import type { DefView, MultiValueVar } from './types';

/** Maps a `VarBinding.kind` (+ literal-string flag) to the `DefView.binding` string. */
function bindingLabel(kind: string, isLiteralString: boolean): string {
  if (kind === 'literal') { return isLiteralString ? 'literal' : 'numeric'; }
  return kind;
}

/**
 * Surfaces variables assigned ≥2 distinct string-literal values (case-insensitive)
 * within one process, with a per-def view (value, binding kind, splittable/refused)
 * suitable for a value-naming UI.
 */
export function multiValueVars(proc: ConsistencyProcess): MultiValueVar[] {
  const combined = proc.units.map(u => u.text).join('\n');
  const parsed = parseTiCode(combined);
  if (!parsed.ok) { return []; }

  // First pass: distinct assigned var names (lowercased) + first-seen original spelling.
  const firstSpelling = new Map<string, string>();
  const order: string[] = [];
  const visit = (stmts: TiStatement[]): void => {
    for (const s of stmts) {
      if (s.type === 'assignment') {
        const lc = s.variable.toLowerCase();
        if (!firstSpelling.has(lc)) {
          firstSpelling.set(lc, s.variable);
          order.push(lc);
        }
      } else if (s.type === 'if') {
        visit(s.thenBody);
        for (const c of s.elseIfClauses) { visit(c.body); }
        visit(s.elseBody);
      } else if (s.type === 'while') {
        visit(s.body);
      }
    }
  };
  visit(parsed.ast);

  const paramNames = proc.params.map(p => p.name);
  const out: MultiValueVar[] = [];

  for (const varLc of order) {
    if (isReservedName(varLc)) { continue; }
    const a = analyzeVariable(combined, paramNames, varLc);
    if (!a) { continue; }

    const literalValues = new Set(
      a.defs.filter(d => d.isLiteralString).map(d => (d.value ?? '').toLowerCase()),
    );
    if (literalValues.size < 2) { continue; }

    const reaching = computeReaching(a.ast, varLc, a.defs, a.reads);

    // A physical line can host multiple `;`-separated statements (unfolded to
    // the same combined-doc line number by the parser). If ≥2 defs of this
    // var share a line, splitting one would silently orphan a read of the
    // other — refuse rather than risk corrupting the process.
    const defLineCount = new Map<number, number>();
    for (const d of a.defs) { defLineCount.set(d.line, (defLineCount.get(d.line) ?? 0) + 1); }
    // Belt-and-suspenders: even a single parsed def on its line can be
    // mis-bound by the LHS heuristic (defsAndReads.ts) when the line also
    // holds a comparison of the same var against a single '=' (invalid TM1 —
    // real comparisons use '@=' — but the tool must refuse, not corrupt).
    const eqCand = eqAssignCandidateLines(combined, varLc);

    const defs: DefView[] = a.defs.map(d => {
      const { unit, line } = combinedLineToUnit(proc.units, d.line);
      const binding = bindingLabel(d.binding.kind, d.isLiteralString);
      if (d.isLiteralString) {
        if ((defLineCount.get(d.line) ?? 0) > 1 || (eqCand.get(d.line) ?? 0) > 1) {
          return { defId: d.id, unit, line, value: d.value, binding, splittable: false, refused: 'ambiguous' };
        }
        const lr = liveRangeOf(a.defs, reaching, d.id);
        const splittable = lr.refused === undefined;
        return { defId: d.id, unit, line, value: d.value, binding, splittable, ...(lr.refused !== undefined ? { refused: lr.refused } : {}) };
      }
      return { defId: d.id, unit, line, value: d.value, binding, splittable: false };
    });

    out.push({ process: proc.name, varName: firstSpelling.get(varLc)!, varLc, defs });
  }

  out.sort((x, y) => x.varName.localeCompare(y.varName));
  return out;
}
