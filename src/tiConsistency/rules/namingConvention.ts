import type { ConsistencyProcess, ConsistencyRule, RawFinding, IdentifierKind, UnitKey, ScanOpts, NamingPrefixes } from '../types';
import { occurrencesOf } from '../scanText';
import { buildProcessEnv, type TiVarType } from '../../references/variableEnv';
import { isReservedName } from '../reserved';

/** Fallback prefixes when the config leaves a slot unset (mirrors the linter's NAMING_PREFIX_DEFAULTS). */
const DEFAULTS: Required<NamingPrefixes> = { numeric: 'n', string: 's', param: 'p', datasource: 'v' };

/** Resolve a prefix slot: config value if present (including '' = rule off), else the default. */
function prefixOf(opts: ScanOpts | undefined, slot: keyof NamingPrefixes): string {
  const v = opts?.namingPrefixes?.[slot];
  return v === undefined ? DEFAULTS[slot] : v;
}

/** Prepend `prefix` to `name`, capitalizing the first letter of `name`. */
export function deriveConventionTarget(name: string, prefix: string): string {
  const rest = name.charAt(0).toUpperCase() + name.slice(1);
  return prefix + rest;
}

/**
 * Build a naming finding for one identifier, or null if it already conforms /
 * the rule is disabled (empty prefix). A local with zero body occurrences is
 * skipped (it originates from a text assignment, so empty means nothing to
 * rename); params/datasource vars are kept even when unreferenced because their
 * declaration is still renameable.
 */
function buildFinding(proc: ConsistencyProcess, nameLc: string, original: string, kind: IdentifierKind, prefix: string): RawFinding | null {
  if (prefix === '' || original.toLowerCase().startsWith(prefix.toLowerCase())) { return null; }
  const target = deriveConventionTarget(original, prefix);
  const occ: RawFinding['occurrences'] = [];
  let spelling = original;
  for (const u of proc.units) {
    for (const o of occurrencesOf(u.text, nameLc)) {
      spelling = o.spelling;
      occ.push({ process: proc.name, unit: u.key as UnitKey, line: o.line, column: o.column, length: o.length });
    }
  }
  if (occ.length === 0 && kind === 'local') { return null; }
  return { key: nameLc, kind, spelling, occurrences: occ, target };
}

/** Local variables assigned in the body, excluding declared params/datasource vars. */
function localTargets(proc: ConsistencyProcess): { nameLc: string; original: string; type: TiVarType | undefined }[] {
  const combined = proc.units.map(u => u.text).join('\n');
  const env = buildProcessEnv(combined, proc.params.map(p => p.name));
  const declared = new Set<string>();
  for (const p of proc.params) { declared.add(p.name.toLowerCase()); }
  for (const v of proc.datasourceVars) { declared.add(v.name.toLowerCase()); }
  const out: { nameLc: string; original: string; type: TiVarType | undefined }[] = [];
  for (const [nameLc, binding] of env.vars) {
    if (declared.has(nameLc)) { continue; }
    if (isReservedName(nameLc)) { continue; }
    // VarBinding('literal').value is the DECODED literal (quotes stripped), so a literal
    // binding is only ever Numeric or String — anything not a bare numeric literal is String.
    const type: TiVarType | undefined = binding.kind === 'literal'
      ? (/^-?\d+(?:\.\d+)?$/.test(binding.value.trim()) ? 'Numeric' : 'String')
      : undefined;
    out.push({ nameLc, original: nameLc, type });
  }
  return out;
}

/** Variable naming: local vars carry `n` (numeric) / `s` (string) prefixes. */
export const variableNamingRule: ConsistencyRule = {
  kind: 'variable-naming',
  editableTarget: true,
  touchesDeclarations: false,
  minVariantsToReport: 1,
  scan(proc: ConsistencyProcess, opts?: ScanOpts): RawFinding[] {
    const nPre = prefixOf(opts, 'numeric');
    const sPre = prefixOf(opts, 'string');
    const out: RawFinding[] = [];
    for (const t of localTargets(proc)) {
      const prefix = t.type === 'Numeric' ? nPre : t.type === 'String' ? sPre : undefined;
      if (prefix === undefined) { continue; } // unknown type → don't flag
      const rf = buildFinding(proc, t.nameLc, t.original, 'local', prefix);
      if (rf) { out.push(rf); }
    }
    return out;
  },
};

/** Parameter naming: parameters carry the `p` prefix (patches the Parameters declaration). */
export const paramNamingRule: ConsistencyRule = {
  kind: 'param-naming',
  editableTarget: true,
  touchesDeclarations: true,
  minVariantsToReport: 1,
  scan(proc: ConsistencyProcess, opts?: ScanOpts): RawFinding[] {
    const pre = prefixOf(opts, 'param');
    const out: RawFinding[] = [];
    for (const p of proc.params) {
      const nameLc = p.name.toLowerCase();
      if (isReservedName(nameLc)) { continue; }
      const rf = buildFinding(proc, nameLc, p.name, 'param', pre);
      if (rf) { out.push(rf); }
    }
    return out;
  },
};

/** Datasource-variable naming: datasource vars carry the `v` prefix (patches the Variables declaration). */
export const datasourceNamingRule: ConsistencyRule = {
  kind: 'datasource-naming',
  editableTarget: true,
  touchesDeclarations: true,
  minVariantsToReport: 1,
  scan(proc: ConsistencyProcess, opts?: ScanOpts): RawFinding[] {
    const pre = prefixOf(opts, 'datasource');
    const out: RawFinding[] = [];
    for (const v of proc.datasourceVars) {
      const nameLc = v.name.toLowerCase();
      if (isReservedName(nameLc)) { continue; }
      const rf = buildFinding(proc, nameLc, v.name, 'datasource', pre);
      if (rf) { out.push(rf); }
    }
    return out;
  },
};
