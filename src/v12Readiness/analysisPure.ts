/**
 * Detectors of the readiness check (spec Phase 1): removed functions, file paths outside
 * the content directory, ODBC, access to unsupported control cubes, plus the call and
 * usage view. Pure — input is the scan result, output is grouped by cause.
 */
import { stripNonCode, V12_DEPRECATED, V12_REPLACEMENTS } from '../tiLogicVisualizer/tiLinter/versionCompatPure';
import { V12_FILE_FUNCTIONS, ESCAPES_CONTENT_DIR } from '../tiLogicVisualizer/tiLinter/rules/check-v12-file-path';
import { EXTRA_REMOVED, functionEvidence, MDX_RULES, MIGRATION_INVALID_NAME_CHARS, UNSUPPORTED_CFG_PARAMS, UNSUPPORTED_CONTROL_CUBES } from './catalogPure';
import { PROC_SECTIONS } from './types';
import type { Analysis, CauseGroup, CompileFailure, Occurrence, ProcSection, RuleId, ScanInput, Severity, Evidence, SourceProcess, UsageRow } from './types';
import { escapeRegex } from '../utils/escapeRegexPure';

const FILE_CALL_RE = new RegExp(`\\b(${V12_FILE_FUNCTIONS.join('|')})\\s*\\(\\s*'([^']*)'`, 'gi');
const ODBC_OPEN_RE = /\bODBCOpen\s*\(\s*('([^']*)')?/gi;
const MDX_LINE_RE = /\b(SubsetCreateByMDX|SubsetMDXSet|ViewCreateByMDX|MDXViewCreate|ExecuteMDX\w*)\s*\(|^\s*\w*mdx\w*\s*=/i;
const PROCESS_CALL_RE = /\b(?:ExecuteProcess|RunProcess)\s*\(\s*(')?/gi;
const CONTROL_CUBE_RE = new RegExp(
  `'(${UNSUPPORTED_CONTROL_CUBES.map(escapeRegex).join('|')})'`, 'gi');
const CONTROL_CUBE_CASING = new Map(UNSUPPORTED_CONTROL_CUBES.map(c => [c.toLowerCase(), c]));

/**
 * Removed names: the signatures' `deprecatedInV12` plus `EXTRA_REMOVED`. Longest first, so
 * `BatchUpdateFinish` does not shadow `BatchUpdateFinishWait`; word boundaries instead of
 * an opening parenthesis because TI allows `SaveDataAll;` without one.
 */
let _removed: { re: RegExp; casing: Map<string, string> } | undefined;
function removedPattern(): { re: RegExp; casing: Map<string, string> } {
  if (!_removed) {
    const casing = new Map<string, string>(V12_DEPRECATED);
    for (const [lc, e] of EXTRA_REMOVED) { casing.set(lc, e.name); }
    const names = [...casing.values()].sort((a, b) => b.length - a.length);
    _removed = { re: new RegExp(`\\b(${names.join('|')})\\b`, 'gi'), casing };
  }
  return _removed;
}

/** TI knows only full-line comments; a `#` later in a line is code or string content. */
const isComment = (line: string): boolean => /^\s*#/.test(line);

/**
 * Cause key of a path: drive or share plus two folders, so that one export directory used
 * by twenty processes is one group. `C:\TM1\Data\In\x.csv` → `C:\TM1\Data`,
 * `\\srv\share\out\b.txt` → `\\srv\share\out`, anything with `..` → `..`. A file
 * that sits higher up keeps the folders it has: `C:\TM1\x.csv` → `C:\TM1`.
 */
export function pathCauseKey(path: string): string {
  if (/(^|[\\/])\.\.([\\/]|$)/.test(path)) { return '..'; }
  const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(path);
  const drive = /^([A-Za-z]):/.exec(path);
  const root = unc ? `\\\\${unc[1]}\\${unc[2]}` : drive ? `${drive[1].toUpperCase()}:` : '';
  const rest = path.slice(unc ? unc[0].length : drive ? 2 : 0).split(/[\\/]/).filter(Boolean);
  // The last part is a file name — unless the literal ends in a separator, as a folder
  // prefix does (`'C:\\TM1\\Out\\' | sFile`). Keep at most two folders (one below a share).
  const dirs = /[\\/]$/.test(path) ? rest : rest.slice(0, -1);
  const folders = dirs.slice(0, unc ? 1 : 2);
  return folders.length ? `${root}\\${folders.join('\\')}` : `${root}\\`;
}

class Groups {
  private readonly map = new Map<string, CauseGroup>();
  add(rule: RuleId, key: string, severity: Severity, evidence: Evidence, occ: Occurrence, replacement?: string): void {
    const id = `${rule}|${key.toLowerCase()}`;
    let g = this.map.get(id);
    if (!g) {
      g = { rule, key, severity, evidence, occurrences: [] };
      if (replacement) { g.replacement = replacement; }
      this.map.set(id, g);
    }
    g.occurrences.push(occ);
  }
  list(): CauseGroup[] {
    const rank: Record<Severity, number> = { blocker: 0, integration: 1, config: 2 };
    const procs = (g: CauseGroup) => new Set(g.occurrences.map(o => o.process)).size;
    return [...this.map.values()].sort((a, b) =>
      rank[a.severity] - rank[b.severity] || procs(b) - procs(a) || a.key.localeCompare(b.key));
  }
}

function scanSection(p: SourceProcess, section: ProcSection, groups: Groups): void {
  const text = p.code[section];
  if (!text) { return; }

  // MDX in TI lives in string literals, so these rules look at the raw line — but only where
  // the line hands MDX to TM1 or builds a variable named like it. A Bedrock process tests
  // `Scan('TM1SUBSETBASIS()', sMDX)`: the name in a string is no MDX (live 11.8, 2026-10-07).
  text.split('\n').forEach((raw, line) => {
    if (isComment(raw) || !MDX_LINE_RE.test(raw)) { return; }
    for (const r of MDX_RULES) {
      if (!r.storedOnly && r.re.test(raw)) {
        groups.add('mdx', r.key, 'blocker', r.evidence, { process: p.name, section, line, detail: r.key });
      }
    }
  });

  const removed = removedPattern();
  text.split('\n').forEach((raw, line) => {
    for (const m of stripNonCode(raw).matchAll(removed.re)) {
      const lc = m[1].toLowerCase();
      const name = removed.casing.get(lc) ?? m[1];
      groups.add('removed-function', name, 'blocker', functionEvidence(name),
        { process: p.name, section, line, detail: name },
        V12_REPLACEMENTS.get(lc) ?? EXTRA_REMOVED.get(lc)?.replacement);
    }
  });

  // Calls may span lines (`AsciiOutput(` / `'C:\\out.csv',`), so these run over the whole
  // section with comment lines blanked; a finding sits on the line of the function name.
  const code = text.split('\n').map(l => (isComment(l) ? '' : l)).join('\n');
  const lineAt = (index: number): number => code.slice(0, index).split('\n').length - 1;
  for (const m of code.matchAll(FILE_CALL_RE)) {
    const path = m[2];
    if (ESCAPES_CONTENT_DIR.test(path)) {
      groups.add('file-path', pathCauseKey(path), 'blocker', 'ibm',
        { process: p.name, section, line: lineAt(m.index), detail: `${m[1]}: ${path}` });
    }
  }
  for (const m of code.matchAll(ODBC_OPEN_RE)) {
    const dsn = m[2] ?? '(dynamic)';
    groups.add('odbc', dsn, 'integration', 'ibm', { process: p.name, section, line: lineAt(m.index), detail: `ODBCOpen: ${dsn}` });
  }
  for (const m of code.matchAll(CONTROL_CUBE_RE)) {
    const cube = CONTROL_CUBE_CASING.get(m[1].toLowerCase()) ?? m[1];
    groups.add('control-cube', cube, 'blocker', 'ibm', { process: p.name, section, line: lineAt(m.index), detail: cube });
  }
}

function scanDataSource(p: SourceProcess, groups: Groups): void {
  const { type, nameForServer } = p.dataSource;
  if (type === 'ODBC') {
    const dsn = nameForServer || '(none)';
    groups.add('odbc', dsn, 'integration', 'ibm', { process: p.name, detail: `Data source ODBC: ${dsn}` });
  } else if (type === 'ASCII' && nameForServer && ESCAPES_CONTENT_DIR.test(nameForServer)) {
    groups.add('file-path', pathCauseKey(nameForServer), 'blocker', 'ibm',
      { process: p.name, detail: `Data source file: ${nameForServer}` });
  }
}

/**
 * Call sites the reference index could not resolve. For their possible targets "no caller"
 * proves nothing. A leading literal is no proof of a static call — `'Load_' | pRegion` starts
 * with one; only when the index itself failed does the literal stand in for it.
 */
function findDynamicCallers(input: ScanInput): string[] {
  const indexed = !input.gaps.includes('process calls');
  const resolved = new Set(input.calls.map(c => `${c.caller.toLowerCase()}|${c.section}|${c.line}`));
  const out: string[] = [];
  for (const p of input.processes) {
    let dynamic = false;
    for (const section of PROC_SECTIONS) {
      const lines = p.code[section].split('\n');
      for (let i = 0; i < lines.length && !dynamic; i++) {
        if (isComment(lines[i])) { continue; }
        for (const m of lines[i].matchAll(PROCESS_CALL_RE)) {
          if (indexed ? !resolved.has(`${p.name.toLowerCase()}|${section}|${i}`) : !m[1]) { dynamic = true; }
        }
      }
    }
    if (dynamic) { out.push(p.name); }
  }
  return out;
}

/**
 * Rules reach control cubes through `DB('}CubeProperties', …)`. Only literal names count;
 * `DB(sCube, …)` cannot be resolved statically. Rule comments start with `#`.
 */
function scanRules(cube: string, text: string, groups: Groups): void {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) { continue; }
    for (const m of lines[i].matchAll(CONTROL_CUBE_RE)) {
      const name = CONTROL_CUBE_CASING.get(m[1].toLowerCase()) ?? m[1];
      groups.add('control-cube', name, 'blocker', 'ibm', { process: cube, rules: true, line: i, detail: name });
    }
  }
}

const isTp = (name: string): boolean => name.toLowerCase().startsWith('}tp_');

function scanObjectNames(input: ScanInput, groups: Groups): void {
  const bad = new Set(MIGRATION_INVALID_NAME_CHARS);
  for (const o of input.objects ?? []) {
    if (isTp(o.name) || (o.parent && isTp(o.parent))) { continue; }
    const chars = [...new Set([...o.name].filter(ch => bad.has(ch)))];
    if (chars.length === 0) { continue; }
    groups.add('invalid-name', o.kind, 'blocker', 'reported',
      { process: o.parent ? `${o.parent} / ${o.name}` : o.name, object: o.kind, detail: chars.join(' ') });
  }
}

/** One cause for all unsupported parameters: they are one configuration task in PA Administration. */
function scanConfig(input: ScanInput, groups: Groups): void {
  const seen = new Set<string>();
  for (const p of input.configParams ?? []) {
    const lc = p.name.toLowerCase();
    if (!UNSUPPORTED_CFG_PARAMS.has(lc) || seen.has(lc)) { continue; }
    seen.add(lc);
    // The report gets saved and passed on: never carry a credential or key value into it.
    const detail = /pass|pwd|user|key|secret/i.test(p.name) ? '***' : p.value;
    groups.add('cfg-param', 'tm1s.cfg', 'config', 'ibm', { process: p.name, object: 'parameter', detail });
  }
}

function scanStoredMdx(input: ScanInput, groups: Groups): void {
  for (const s of input.mdxSources ?? []) {
    if (isTp(s.owner) || isTp(s.name)) { continue; }
    const where = { process: `${s.owner} / ${s.name}`, object: s.kind };
    for (const r of MDX_RULES) {
      if (r.re.test(s.mdx)) { groups.add('mdx', r.key, 'blocker', r.evidence, { ...where, detail: r.key }); }
    }
  }
}

export function analyse(input: ScanInput): Analysis {
  // TM1 Applications are their own decision: scanned, but kept out of every count below.
  const tpGroups = new Groups();
  const tpProcs = input.processes.filter(p => isTp(p.name));
  for (const p of tpProcs) { for (const section of PROC_SECTIONS) { scanSection(p, section, tpGroups); } }
  const tpBlocked = [...new Set(tpGroups.list().filter(g => g.severity === 'blocker').flatMap(g => g.occurrences.map(o => o.process)))].sort();
  input = { ...input, processes: input.processes.filter(p => !isTp(p.name)), calls: input.calls.filter(c => !isTp(c.caller)) };

  const groups = new Groups();
  scanObjectNames(input, groups);
  scanConfig(input, groups);
  scanStoredMdx(input, groups);
  for (const c of input.cubeRules ?? []) { if (!isTp(c.cube)) { scanRules(c.cube, c.rules, groups); } }
  for (const p of input.processes) {
    scanDataSource(p, groups);
    for (const section of PROC_SECTIONS) { scanSection(p, section, groups); }
  }
  // Compile check: the static rules already explain most rejections (SaveDataAll is one
  // finding, not two). A compiler error counts as explained only when a static blocker sits in
  // the same statement — the compiler reports "on or before" the end of it. A path blocker in
  // the prolog explains nothing about an undefined variable in the data tab.
  let compileSummary: Analysis['compileSummary'];
  const cr = input.compile;
  if (cr) {
    const staticAt = new Set(groups.list().filter(g => g.severity === 'blocker')
      .flatMap(g => g.occurrences.filter(o => !o.object && !o.rules && o.section && o.line !== undefined)
        .map(o => `${o.process.toLowerCase()}|${o.section}|${o.line}`)));
    const codeOf = new Map(input.processes.map(p => [p.name.toLowerCase(), p.code]));
    const explained = (f: CompileFailure): boolean => {
      const lc = f.process.toLowerCase();
      const lines = (codeOf.get(lc)?.[f.section] ?? '').split('\n');
      for (let i = f.line; i >= 0; i--) {
        if (i < f.line && /;\s*$/.test(stripNonCode(lines[i] ?? ''))) { return false; }
        if (staticAt.has(`${lc}|${f.section}|${i}`)) { return true; }
      }
      return false;
    };
    const failures = cr.failures.filter(f => !isTp(f.process));
    const rejected = new Set(failures.map(f => f.process.toLowerCase()));
    const unexplained = new Set<string>();
    for (const f of failures) {
      if (explained(f)) { continue; }
      unexplained.add(f.process.toLowerCase());
      // Group by the message without its quoted parts: "Variable 'v10' is undefined" is one kind.
      const kind = f.message.split('\n')[0].replace(/'[^']*'/g, "'…'").trim().slice(0, 80);
      groups.add('compile-error', kind, 'blocker', 'measured',
        { process: f.process, section: f.section, line: f.line, detail: f.message.replace(/\s+/g, ' ').slice(0, 200) });
    }
    compileSummary = {
      server: cr.server, ...(cr.version ? { version: cr.version } : {}), checked: cr.checked, partial: cr.partial,
      rejected: rejected.size, alsoStatic: [...rejected].filter(n => !unexplained.has(n)).length,
      notCheckable: (cr.notCheckable ?? []).filter(n => !isTp(n)).length,
    };
  }
  const list = groups.list();

  const blockedLc = new Set(list.filter(g => g.severity === 'blocker')
    .flatMap(g => g.occurrences.filter(o => !o.rules && !o.object).map(o => o.process.toLowerCase())));
  // A caller of a broken TM1 Applications process fails on TM1 12 just the same.
  tpBlocked.forEach(n => blockedLc.add(n.toLowerCase()));
  const byCaller = new Map<string, Set<string>>();
  const callersOf = new Map<string, Set<string>>();
  for (const c of input.calls) {
    const calleeLc = c.callee.toLowerCase();
    if (!callersOf.has(calleeLc)) { callersOf.set(calleeLc, new Set()); }
    callersOf.get(calleeLc)!.add(c.caller);
    // Only callers WITHOUT a blocker of their own — those already stand in their cause group.
    if (blockedLc.has(calleeLc) && !blockedLc.has(c.caller.toLowerCase())) {
      if (!byCaller.has(c.caller)) { byCaller.set(c.caller, new Set()); }
      byCaller.get(c.caller)!.add(c.callee);
    }
  }
  const affectedViaCall = [...byCaller]
    .map(([process, callees]) => ({ process, callees: [...callees].sort() }))
    .sort((a, b) => a.process.localeCompare(b.process));

  const ranLc = new Set(input.runLog?.processesLc ?? []);
  const activeLc = new Set(input.activeChoreProcessesLc);
  const userProcs = input.processes.filter(p => !p.name.startsWith('}'));
  const usageNotEvidenced: UsageRow[] = userProcs
    .map(p => {
      const lc = p.name.toLowerCase();
      return {
        process: p.name,
        ranInWindow: ranLc.has(lc),
        inActiveChore: activeLc.has(lc),
        calledBy: [...(callersOf.get(lc) ?? [])].filter(c => c.toLowerCase() !== lc).sort(),
      };
    })
    .filter(r => !r.ranInWindow && !r.inActiveChore && r.calledBy.length === 0)
    .sort((a, b) => a.process.localeCompare(b.process));

  return {
    groups: list,
    affectedViaCall,
    dynamicCallers: findDynamicCallers(input).sort(),
    usageNotEvidenced,
    processCount: input.processes.length,
    controlProcessCount: input.processes.length - userProcs.length,
    ...(compileSummary ? { compileSummary } : {}),
    ...(input.cubeRules ? { rulesCubeCount: input.cubeRules.filter(c => !isTp(c.cube)).length } : {}),
    tm1Applications: { processes: tpProcs.length, chores: input.tpChores ?? 0, withBlocker: tpBlocked },
  };
}
