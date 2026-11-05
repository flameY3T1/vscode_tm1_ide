import type { ConsistencyProcess, ConsistencyRule, FindingGroup, RenamePlan, RuleKind, UnitKey, Variant, IdentifierKind, ScanOpts } from './types';
import { renameIdentifier, occurrencesOf, maskCode } from './scanText';
import { varCasingRule, paramCasingRule, datasourceCasingRule } from './rules/varCasing';
import { functionCasingRule } from './rules/functionCasing';
import { keywordCasingRule } from './rules/keywordCasing';
import { variableNamingRule, paramNamingRule, datasourceNamingRule } from './rules/namingConvention';

const RULES: Record<RuleKind, ConsistencyRule> = {
  'var-casing': varCasingRule,
  'param-casing': paramCasingRule,
  'datasource-casing': datasourceCasingRule,
  'function-casing': functionCasingRule,
  'keyword-casing': keywordCasingRule,
  'variable-naming': variableNamingRule,
  'param-naming': paramNamingRule,
  'datasource-naming': datasourceNamingRule,
};
export function ruleFor(kind: RuleKind): ConsistencyRule { return RULES[kind]; }

export function runRule(kind: RuleKind, processes: ConsistencyProcess[], opts?: ScanOpts): FindingGroup[] {
  const rule = ruleFor(kind);
  const byKey = new Map<string, { kind: IdentifierKind; target?: string; variants: Map<string, Variant> }>();
  for (const proc of processes) {
    for (const rf of rule.scan(proc, opts)) {
      let g = byKey.get(rf.key);
      if (!g) { g = { kind: rf.kind, target: rf.target, variants: new Map() }; byKey.set(rf.key, g); }
      if (rf.target && !g.target) { g.target = rf.target; }
      let v = g.variants.get(rf.spelling);
      if (!v) { v = { spelling: rf.spelling, count: 0, occurrences: [] }; g.variants.set(rf.spelling, v); }
      v.count += rf.occurrences.length;
      v.occurrences.push(...rf.occurrences);
    }
  }
  // var-casing's per-process "local" classification only recognizes a name as a local
  // variable in processes where it is ASSIGNED (see rules/varCasing.ts identifierKinds,
  // which derives locals from collectAssignedVariables — LHS-only). A process that only
  // READS a name assigned in a different process (a realistic pattern: TM1 TI doesn't
  // require pre-declaration, an unassigned read just yields the type default) never
  // contributes a RawFinding for that key, even though it's the same conceptual
  // identifier model-wide. Backfill: once a 'local' key is established by some process's
  // scan, pick up any additional whole-word occurrences of that key in every OTHER
  // process too, so cross-process casing drift on read-only references isn't dropped.
  if (kind === 'var-casing') {
    for (const [key, g] of byKey) {
      if (g.kind !== 'local') { continue; }
      for (const proc of processes) {
        const alreadyScanned = [...g.variants.values()].some(v => v.occurrences.some(o => o.process === proc.name));
        if (alreadyScanned) { continue; }
        for (const u of proc.units) {
          for (const o of occurrencesOf(u.text, key)) {
            let v = g.variants.get(o.spelling);
            if (!v) { v = { spelling: o.spelling, count: 0, occurrences: [] }; g.variants.set(o.spelling, v); }
            v.count += 1;
            v.occurrences.push({ process: proc.name, unit: u.key, line: o.line, column: o.column, length: o.length });
          }
        }
      }
    }
  }

  const out: FindingGroup[] = [];
  for (const [key, g] of byKey) {
    const variants = [...g.variants.values()].sort((a, b) => b.count - a.count);
    const target = g.target ?? variants[0]?.spelling ?? '';
    if (variants.length < rule.minVariantsToReport) { continue; }
    if (variants.every(v => v.spelling === target)) { continue; }
    out.push({ key, kind: g.kind, targetSuggestion: target, editableTarget: rule.editableTarget, variants });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * All identifier-ish whole-word tokens present in a process (for collision detection).
 * Token-collection runs over masked (string/comment-blanked) text — consistent with
 * occurrencesOf/renameIdentifier — so a target name that only appears inside a string
 * literal or comment is not mistaken for an existing identifier (see Task 6 review Finding 1).
 */
function keysInProcess(proc: ConsistencyProcess): Set<string> {
  const keys = new Set<string>();
  for (const p of proc.params) { keys.add(p.name.toLowerCase()); }
  for (const v of proc.datasourceVars) { keys.add(v.name.toLowerCase()); }
  const combined = proc.units.map(u => u.text).join('\n');
  const masked = maskCode(combined);
  for (const m of masked.matchAll(/(?<![A-Za-z0-9_])([A-Za-z_]\w*)(?![A-Za-z0-9_])/g)) { keys.add(m[1].toLowerCase()); }
  return keys;
}

export function planRename(kind: RuleKind, group: FindingGroup, target: string, processes: ConsistencyProcess[]): RenamePlan {
  const rule = ruleFor(kind);
  const edits: RenamePlan['edits'] = [];
  const skipped: RenamePlan['skipped'] = [];
  const targetLc = target.toLowerCase();
  for (const proc of processes) {
    const combined = proc.units.map(u => u.text).join('\n');
    // A process qualifies for renaming if the key is either referenced in the body,
    // or declared as a param/datasource var in this process (decl-only rename —
    // naming-convention can flag params/datasource vars with zero body occurrences).
    const isDecl = proc.params.some(p => p.name.toLowerCase() === group.key)
      || proc.datasourceVars.some(v => v.name.toLowerCase() === group.key);
    const bodyOccurrences = occurrencesOf(combined, group.key).length;
    if (bodyOccurrences === 0 && !isDecl) { continue; }
    if (targetLc !== group.key && keysInProcess(proc).has(targetLc)) {
      skipped.push({ process: proc.name, reason: `target '${target}' already used in ${proc.name}` });
      continue;
    }
    const changedSections: Partial<Record<UnitKey, string>> = {};
    for (const u of proc.units) {
      const next = renameIdentifier(u.text, group.key, target);
      if (next !== u.text) { changedSections[u.key] = next; }
    }
    const edit: RenamePlan['edits'][number] = { process: proc.name, changedSections };
    if (rule.touchesDeclarations) {
      const p = proc.params.find(x => x.name.toLowerCase() === group.key);
      const dv = proc.datasourceVars.find(x => x.name.toLowerCase() === group.key);
      if (p) { edit.declPatch = { params: [{ from: p.name, to: target }] }; }
      else if (dv) { edit.declPatch = { datasourceVars: [{ from: dv.name, to: target }] }; }
    }
    // Skip only when there is nothing to change: no body edits AND no decl patch.
    if (Object.keys(changedSections).length === 0 && !edit.declPatch) { continue; }
    edits.push(edit);
  }
  return { edits, skipped };
}
