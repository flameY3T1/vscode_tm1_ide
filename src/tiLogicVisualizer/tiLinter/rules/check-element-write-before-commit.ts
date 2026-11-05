import { TiFunctionCall, TiStatement } from '../../types';
import { LintDiagnose, TiSection } from '../../lintTypes';
import { LintOptions } from '../types';
import { collectFunctionCalls, tiTokensMatch } from '../helpers/calls';

/**
 * `element-write-before-commit`: a cell or attribute write in Prolog/Metadata
 * on an element that is still sitting in the dimension's uncommitted copy.
 *
 * Live-measured on TM1 11.8 (2026-10-09, throwaway dimension + cube):
 * - A non-Direct structural call (`DimensionElementInsert`,
 *   `DimensionElementComponentAdd`, `HierarchyElementInsert`,
 *   `HierarchyElementComponentAdd`) puts the dimension into a pending copy that
 *   TM1 commits only after the Metadata section. `CellPutN`, `AttrPutS/N` and
 *   `ElementAttrPutS/N` on an element inserted there fail with
 *   `Element "e" not found` — in the Prolog AND in the Metadata; Data and
 *   Epilog see it.
 * - Once a dimension has a pending change, even a later `…InsertDirect` on the
 *   same dimension lands in the pending copy — its element is not writable
 *   either. A Direct insert BEFORE the first non-Direct call is writable.
 * - A pending change on ANOTHER dimension does not matter.
 *
 * Matching is by element token (`tiTokensMatch`), so the rule stays silent
 * for writes to elements that already existed. Not tracked: the child of a
 * non-Direct `…ComponentAdd` (TM1 creates a missing child, but usually it
 * exists already — tracking it would flag every existing element).
 */
interface Insert { call: TiFunctionCall; dimArg: number; elArg?: number; direct: boolean }

const INSERTS: Record<string, Omit<Insert, 'call'>> = {
  dimensionelementinsert:          { dimArg: 0, elArg: 2, direct: false },
  dimensionelementcomponentadd:    { dimArg: 0, direct: false },
  hierarchyelementinsert:          { dimArg: 0, elArg: 3, direct: false },
  hierarchyelementcomponentadd:    { dimArg: 0, direct: false },
  dimensionelementinsertdirect:    { dimArg: 0, elArg: 2, direct: true },
  hierarchyelementinsertdirect:    { dimArg: 0, elArg: 3, direct: true },
};

/** Element arguments of a write; `dimArg` undefined = cube write (any dimension). */
function writeTargets(call: TiFunctionCall): { dimArg?: number; elArgs: number[] } | undefined {
  switch (call.name.toLowerCase()) {
    case 'cellputn':
    case 'cellputs':
    case 'cellincrementn':
      return { elArgs: call.args.map((_, i) => i).slice(2) };
    case 'attrputs':
    case 'attrputn':
      return { dimArg: 1, elArgs: [2] };
    case 'elementattrputs':
    case 'elementattrputn':
      return { dimArg: 1, elArgs: [3] };
    default:
      return undefined;
  }
}

export function checkElementWriteBeforeCommit(
  ast: TiStatement[],
  section: TiSection | undefined,
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  if (section !== 'prolog' && section !== 'metadata') { return; }
  // The Metadata still sees the Prolog's pending copy: walk the earlier
  // sections first, report only calls of the current one.
  const earlier = section === 'metadata'
    ? (options?.previousAsts ?? []).flatMap(a => collectFunctionCalls(a))
    : [];
  const current = collectFunctionCalls(ast);
  if (current.length === 0) { return; }

  const pendingDims: string[] = [];
  const pending: Array<{ dim: string; el: string }> = [];
  const isPending = (dim: string) => pendingDims.some(d => tiTokensMatch(d, dim));

  for (const [idx, call] of [...earlier, ...current].entries()) {
    const ins = INSERTS[call.name.toLowerCase()];
    if (ins) {
      const dim = call.args[ins.dimArg];
      if (dim === undefined) { continue; }
      if (!ins.direct && !isPending(dim)) { pendingDims.push(dim); }
      const el = ins.elArg !== undefined ? call.args[ins.elArg] : undefined;
      if (el !== undefined && isPending(dim)) { pending.push({ dim, el }); }
      continue;
    }
    if (idx < earlier.length || pending.length === 0) { continue; }
    const target = writeTargets(call);
    if (!target) { continue; }
    const dim = target.dimArg !== undefined ? call.args[target.dimArg] : undefined;
    const hit = pending.find(p =>
      (dim === undefined || tiTokensMatch(p.dim, dim))
      && target.elArgs.some(i => call.args[i] !== undefined && tiTokensMatch(p.el, call.args[i])));
    if (hit) {
      diagnostics.push({
        line: call.line,
        severity: 'warning',
        ruleId: 'element-write-before-commit',
        messageKey: '{0} is not in {1} yet: a non-Direct insert commits only after Metadata. Use the Direct function or write in Data/Epilog.',
        messageArgs: [hit.el.trim(), hit.dim.trim()],
      });
    }
  }
}
