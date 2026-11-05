import type { ConsistencyProcess, ConsistencyRule, RawFinding, IdentifierKind, UnitKey, RuleKind } from '../types';
import { occurrencesOf } from '../scanText';
import { parseTiCode } from '../../tiLogicVisualizer/tiParser';
import { collectAssignedVariables } from '../../tiLogicVisualizer/tiLinter';
import { isReservedName } from '../reserved';

/** Which identifier source a casing rule scans. */
type CasingSource = 'local' | 'param' | 'datasource';

/** Collect the identifier names (lowercase) of one source, minus reserved names. */
function sourceNames(proc: ConsistencyProcess, source: CasingSource): Set<string> {
  const names = new Set<string>();
  if (source === 'param') {
    for (const p of proc.params) {
      const lc = p.name.toLowerCase();
      if (!isReservedName(lc)) { names.add(lc); }
    }
    return names;
  }
  if (source === 'datasource') {
    for (const v of proc.datasourceVars) {
      const lc = v.name.toLowerCase();
      if (!isReservedName(lc)) { names.add(lc); }
    }
    return names;
  }
  // local: assigned variables that are neither a declared param/datasource var
  // (those are owned by the param/datasource rules) nor a reserved name.
  const declared = new Set<string>();
  for (const p of proc.params) { declared.add(p.name.toLowerCase()); }
  for (const v of proc.datasourceVars) { declared.add(v.name.toLowerCase()); }
  const combined = proc.units.map(u => u.text).join('\n');
  const parsed = parseTiCode(combined);
  if (parsed.ok) {
    for (const nameLc of collectAssignedVariables(parsed.ast)) {
      if (!declared.has(nameLc) && !isReservedName(nameLc)) { names.add(nameLc); }
    }
  }
  return names;
}

function scanSource(proc: ConsistencyProcess, source: CasingSource, kind: IdentifierKind): RawFinding[] {
  const out: RawFinding[] = [];
  for (const nameLc of sourceNames(proc, source)) {
    const bySpelling = new Map<string, RawFinding>();
    for (const u of proc.units) {
      for (const o of occurrencesOf(u.text, nameLc)) {
        let rf = bySpelling.get(o.spelling);
        if (!rf) {
          rf = { key: nameLc, kind, spelling: o.spelling, occurrences: [] };
          bySpelling.set(o.spelling, rf);
        }
        rf.occurrences.push({ process: proc.name, unit: u.key as UnitKey, line: o.line, column: o.column, length: o.length });
      }
    }
    out.push(...bySpelling.values());
  }
  return out;
}

function makeCasingRule(ruleKind: RuleKind, source: CasingSource, idKind: IdentifierKind): ConsistencyRule {
  return {
    kind: ruleKind,
    editableTarget: true,
    // Locals have no formal declaration to patch; params/datasource vars do.
    touchesDeclarations: source !== 'local',
    minVariantsToReport: 2,
    scan: (proc: ConsistencyProcess): RawFinding[] => scanSource(proc, source, idKind),
  };
}

/** Local-variable casing. Read-only cross-process references are backfilled in engine.runRule. */
export const varCasingRule: ConsistencyRule = makeCasingRule('var-casing', 'local', 'local');
/** Parameter-name casing (patches the Parameters declaration on apply). */
export const paramCasingRule: ConsistencyRule = makeCasingRule('param-casing', 'param', 'param');
/** Datasource-variable casing (patches the Variables declaration on apply). */
export const datasourceCasingRule: ConsistencyRule = makeCasingRule('datasource-casing', 'datasource', 'datasource');
