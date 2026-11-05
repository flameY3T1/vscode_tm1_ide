// Data source of a process: what is set on the process object and what the code
// assigns via DatasourceNameForServer/-Type & co.
import { resolveExpression, TI_ASSIGN_RE, type ProcessEnv } from './variableEnv';
import { truncateSnippet } from './refExtract';
import { extractStringLiteral } from '../tiLogicVisualizer/tiObjectCalls';
import type { DataSourceScope, FileSourceDir } from './referenceTypes';

// ─── Datenquelle ─────────────────────────────────────────────────────────────

/**
 * What `DatasourceNameForServer` points at — that decides the KIND of the
 * data source, not the name.
 *
 * Measured live (11.8, 2026-09-19) on an import process:
 * `DataSourceType = 'CHARACTERDELIMITED';` and
 * `DatasourceNameForServer = sDatei;` — the value is a FILE PATH. That it
 * cannot be resolved statically is entirely irrelevant for cubes and
 * dimensions, and a warning about it does not belong in any delete dialog.
 */
export type DataSourceKind = 'cube' | 'dimension' | 'other' | 'unknown';

/** TI spellings of `DatasourceType` and the REST values in one map. */
const DS_TYPE_KIND = new Map<string, DataSourceKind>([
  ['view', 'cube'],
  ['tm1cubeview', 'cube'],
  ['subset', 'dimension'],
  ['tm1dimensionsubset', 'dimension'],
  ['characterdelimited', 'other'],
  ['fixedwidth', 'other'],
  ['ascii', 'other'],
  ['odbc', 'other'],
  ['null', 'other'],
  ['none', 'other'],
]);

/**
 * The kind of data source that APPLIES in the process.
 *
 * First the one set in code (it overrides the logged-in one), otherwise the
 * logged-in one. Deliberately simplified: in practice it is set once in the
 * prolog, so the first resolvable assignment counts and not the state per
 * line. If two assignments contradict each other, it stays `unknown` — then
 * nothing is excluded.
 */
export function effectiveDataSourceKind(
  sections: readonly string[],
  env: ProcessEnv | undefined,
  declaredType: string | undefined,
): DataSourceKind {
  const seen = new Set<DataSourceKind>();
  for (const text of sections) {
    for (const line of (text ?? '').split('\n')) {
      const m = TI_ASSIGN_RE.exec(line);
      if (!m || m[2].startsWith('=')) { continue; }
      if (m[1].toLowerCase() !== 'datasourcetype') { continue; }
      let value = extractStringLiteral(m[2]);
      if (value === null && env) {
        const b = resolveExpression(m[2], env);
        value = b.kind === 'literal' ? b.value : null;
      }
      seen.add(value === null ? 'unknown' : DS_TYPE_KIND.get(value.toLowerCase()) ?? 'unknown');
    }
  }
  if (seen.size === 1) { return [...seen][0]; }
  if (seen.size > 1) { return 'unknown'; }
  return declaredType === undefined ? 'unknown' : DS_TYPE_KIND.get(declaredType.toLowerCase()) ?? 'unknown';
}

/** The four globals that redirect the data source at runtime. */
const DS_GLOBALS = new Map<string, DataSourceScope>([
  ['datasourcenameforserver', 'parent'],
  ['datasourcenameforclient', 'parent'],
  ['datasourcecubeview', 'view'],
  ['datasourcedimensionsubset', 'subset'],
]);

export interface DatasourceAssignment {
  line: number;
  /** Name of the global in its spelling from the source text. */
  global: string;
  /** What the global points at — decides whom a gap concerns at all. */
  scope: DataSourceScope;
  /**
   * The name the assignment points at — or `null` if it cannot be determined
   * statically (parameter, concatenation, `CellGetS`). `null` is NOT "no
   * reference": it is a limit of the analysis and must be passed on as such,
   * otherwise the delete dialog says "free" about a cube whose usage nobody
   * could see.
   */
  value: string | null;
  snippet: string;
}

/**
 * Assignments to the data source globals from ONE section.
 *
 * With `env` it also resolves `sCube = \'Umsatz\'; DatasourceNameForServer = sCube;`
 * — the same variable tracking that `extractTiReferences` uses for call
 * arguments. Whatever cannot be traced back to a literal (concatenation,
 * loop, `CellGetS`) comes back with `value: null` instead of being
 * discarded: nothing is guessed, but the limit of the analysis deserves a name.
 */
export function extractDatasourceAssignments(
  text: string,
  env?: ProcessEnv,
  /**
   * The kind of data source that applies in the process. It decides what
   * `DatasourceNameForServer` points at — for a file or a DSN at no TM1 object
   * at all, and such assignments then never make it into the list.
   */
  kind: DataSourceKind = 'unknown',
): DatasourceAssignment[] {
  if (!text) { return []; }
  const out: DatasourceAssignment[] = [];
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const m = TI_ASSIGN_RE.exec(line);
    if (!m || m[2].startsWith('=')) { continue; }
    const declared = DS_GLOBALS.get(m[1].toLowerCase());
    if (declared === undefined) { continue; }
    // `parent` means "cube OR dimension, we do not know". If the kind is
    // fixed, it becomes the one — or none at all if the source is a file
    // or a DSN.
    let scope: DataSourceScope;
    if (declared !== 'parent') {
      scope = declared;
    } else if (kind === 'other') {
      continue;
    } else if (kind === 'cube' || kind === 'dimension') {
      scope = kind;
    } else {
      scope = 'parent';
    }
    let value = extractStringLiteral(m[2]);
    if (value === null && env) {
      const binding = resolveExpression(m[2], env);
      value = binding.kind === 'literal' ? binding.value : null;
    }
    out.push({
      line: lineIdx, global: m[1], scope,
      value: value === '' ? null : value,
      snippet: truncateSnippet(line),
    });
  }
  return out;
}

// ─── File sources: the directory, not the file ───────────────────────────────


const SEP_RE = /[\\/]/;

/** `C:\a\b\file.txt` → `C:\a\b\`; a name without any separator has no folder. */
function dirOf(path: string): string | undefined {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i < 0 ? undefined : path.slice(0, i + 1);
}

/** Operands of a `|` concatenation; pipes inside quotes or brackets are no operators. */
function operands(expr: string): string[] {
  const out: string[] = [];
  let inQ = false, depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") { inQ = !inQ; continue; }
    if (inQ) { continue; }
    if (c === '(') { depth++; } else if (c === ')') { depth--; }
    else if (c === '|' && depth === 0) { out.push(expr.slice(start, i).trim()); start = i + 1; if (expr[i + 1] === '|') { i++; start++; } }
  }
  out.push(expr.slice(start).trim());
  return out.filter(o => o !== '');
}

/** `'x'` stays `x`, a variable becomes `{name}`, anything else `{…}`. */
function renderPart(op: string, assigns: Map<string, string>): string {
  const lit = extractStringLiteral(op);
  if (lit !== null) { return lit; }
  if (/^[A-Za-z_][\w.]*$/.test(op)) {
    const bound = assigns.get(op.toLowerCase());
    const boundLit = bound === undefined ? null : extractStringLiteral(bound);
    return boundLit !== null ? boundLit : `{${op}}`;
  }
  return '{…}';
}

const CELLGET_RE = /^cellgets\s*\(\s*([^,]+?)\s*,\s*'([^']*)'/i;

/**
 * The folder of a file source, measured on real imports (11.8, 2026-09-26):
 * 35 of 54 file processes set `DatasourceNameForServer` in the prolog, almost
 * always as `<folder> | <name parts with year and month> | '.txt'`, and the
 * folder mostly comes from a parameter cube: `x = CellGetS(csCubeParam,
 * 'IMP_Data', 'Text')`. The file name changes per run; the folder does not.
 *
 * Rule: follow the leading operand of the assignment through plain variable
 * assignments. A quoted path gives the folder; a `CellGetS` gives a symbolic
 * folder keyed by cube and element (the same key in two processes is the same
 * folder). Nothing resolvable — a parameter, a function — falls back to the
 * folder of the declared source.
 */
export function fileSourceDir(sections: readonly string[], declaredPath: string | undefined): FileSourceDir | undefined {
  const assigns = new Map<string, string>();
  let dsExpr: string | undefined;
  for (const text of sections) {
    for (const stmt of tiStatements(text)) {
      const m = STMT_ASSIGN_RE.exec(stmt);
      if (!m || m[2].startsWith('=')) { continue; }
      const rhs = m[2].trim();
      if (m[1].toLowerCase() === 'datasourcenameforserver') { dsExpr = rhs; } else { assigns.set(m[1].toLowerCase(), rhs); }
    }
  }
  const declaredDir = declaredPath ? dirOf(declaredPath) : undefined;
  const fallback = declaredDir ? { key: `dir:${declaredDir.toLowerCase()}`, path: declaredDir } : undefined;
  if (dsExpr === undefined) { return fallback; }

  const resolveName = (arg: string): string => {
    const lit = extractStringLiteral(arg);
    if (lit !== null) { return lit; }
    const bound = assigns.get(arg.trim().toLowerCase());
    return bound !== undefined && extractStringLiteral(bound) !== null ? extractStringLiteral(bound)! : arg.trim();
  };
  const declaredFile = declaredPath ? declaredPath.split(SEP_RE).pop() : undefined;
  const withFile = (d: FileSourceDir | undefined, file: string | undefined): FileSourceDir | undefined =>
    d && (file || declaredFile) ? { ...d, file: file || declaredFile } : d;
  // The name is everything after the folder, collected level by level while
  // the lead is followed: `csDatei` → `sIMP_DATA | 'SAP' | psJahr` → CellGetS.
  const tails: string[][] = [];
  let expr = dsExpr;
  for (let depth = 0; depth < 6; depth++) {
    const ops = operands(expr);
    const lead = ops[0] ?? '';
    tails.unshift(ops.slice(1));
    const name = (head = ''): string => head + tails.flat().map(o => renderPart(o, assigns)).join('');
    const lit = extractStringLiteral(lead);
    if (lit !== null) {
      // A quoted lead with a separator carries the folder; a bare name does not.
      const dir = SEP_RE.test(lit) ? dirOf(lit) : undefined;
      return dir
        ? withFile({ key: `dir:${dir.toLowerCase()}`, path: dir }, name(lit.slice(dir.length)))
        : withFile(fallback, name(lit));
    }
    const cell = CELLGET_RE.exec(lead);
    if (cell) {
      const cube = resolveName(cell[1]);
      const setBy = `CellGetS(${cube}, '${cell[2]}')`;
      return withFile({ key: `cell:${cube.toLowerCase()}|${cell[2].toLowerCase()}`, path: declaredDir, setBy }, name());
    }
    const next = /^[A-Za-z_][\w.]*$/.test(lead) ? assigns.get(lead.toLowerCase()) : undefined;
    // Folder unknown (a parameter, a function): the parts after it are still the name.
    if (next === undefined || next === expr) { return withFile(fallback, tails.flat().length ? name().replace(/^[\\/]+/, '') : undefined); }
    expr = next;
  }
  return withFile(fallback, undefined);
}

/** `name = rest` of one whole statement (comments and `;` already gone). */
const STMT_ASSIGN_RE = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+?)\s*$/;

/**
 * The statements of a TI section: split at `;` outside quotes, so an
 * assignment continued over several lines stays one statement and a `#`
 * inside a quoted path is not taken for a comment. `#` lines are dropped.
 */
function tiStatements(text: string | undefined): string[] {
  const code = (text ?? '').split('\n').filter(l => !l.trim().startsWith('#')).join('\n').replace(/\r/g, '');
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "'") { quoted = !quoted; } else if (code[i] === ';' && !quoted) {
      out.push(code.slice(start, i));
      start = i + 1;
    }
  }
  out.push(code.slice(start));
  return out.filter(t => t.trim() !== '');
}

/**
 * True when the FROM at `at` belongs to a function like `EXTRACT(YEAR FROM x)`
 * or `SUBSTRING(s FROM 2)`: its innermost open bracket holds no SELECT.
 * A subquery `(SELECT … FROM t)` does.
 */
function insideFunctionCall(sql: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (sql[i] === ')') { depth++; } else if (sql[i] === '(') {
      if (depth === 0) { return !/\bselect\b/i.test(sql.slice(i + 1, at)); }
      depth--;
    }
  }
  return false;
}

/**
 * Tables an ODBC process reads: FROM/JOIN names in the query stored on the
 * process and in `DatasourceQuery` assignments. Only the quoted parts of an
 * assigned query are read — a table name built from a variable stays unknown.
 * Measured on 11.8 (2026-09-26): 16 of 17 ODBC processes carry the query on the
 * object, 8 also set it in code.
 */
export function odbcTables(sections: readonly string[], storedQuery: string | undefined): string[] {
  const texts = [storedQuery ?? ''];
  for (const text of sections) {
    for (const stmt of tiStatements(text)) {
      const m = STMT_ASSIGN_RE.exec(stmt);
      if (!m || m[1].toLowerCase() !== 'datasourcequery') { continue; }
      texts.push(operands(m[2]).map(o => extractStringLiteral(o) ?? ' ').join(''));
    }
  }
  const seen = new Map<string, string>();
  for (const t of texts) {
    for (const m of t.matchAll(/\b(?:from|join)\s+((?:[[\]"`\w]+\.)*[[\]"`\w]+)/gi)) {
      if (insideFunctionCall(t, m.index)) { continue; }
      const name = m[1].replace(/[[\]"`]/g, '');
      if (!seen.has(name.toLowerCase())) { seen.set(name.toLowerCase(), name); }
    }
  }
  return [...seen.values()];
}
