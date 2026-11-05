/**
 * Top-level orchestrator. Takes pre-split TI sections (the caller decides
 * whether the source had #region markers or arrives as 4 separate files),
 * parses each, binds parameters into the process scope, runs prolog once,
 * iterates over the source rows for the data section (binding vdim_*),
 * runs metadata + epilog once. Returns aggregated cell-write output +
 * warnings.
 */

import type { Section, SimWarning, Value, Fixtures, RunSections } from '../types';
import { SECTIONS } from '../types';
import { parseStatements } from '../ast/parseStatement';
import { Scope } from '../eval/scope';
import { runProcessSections } from '../eval/evalStatement';
import { OutputCollector } from '../output/outputCollector';
import { rowBindings, type SourceTable, type SourceRow } from '../source/csvSource';
import type { SubProcessLoader } from '../eval/subProcess';

export type { RunSections } from '../types';

export type RunInput = {
  sections: RunSections;
  parameters?: Record<string, Value>;
  source?: SourceTable;
  variableNames?: string[];
  /** Optional fixtures for DIMIX/CellGetN/etc. */
  fixtures?: Fixtures;
  /** Phase 2.5: resolves `ExecuteProcess('X', ...)` to a sub module on disk. */
  subProcessLoader?: SubProcessLoader;
};

export type RunResult = {
  output: OutputCollector;
  warnings: SimWarning[];
  parseErrors: { section: Section; line: number; message: string }[];
};

/**
 * Bind a source record's DataSource variables (plus TM1's per-row cube-view
 * auto-vars NValue / SValue / value_is_string) INTO the given scope, overwriting
 * per record. Used for BOTH the Metadata and Data passes — TM1 runs each section
 * once per record. The Metadata pass binds into the shared process scope so that
 * non-datasource variables it assigns persist into the Data pass (TM1 globals).
 */
function applyRowBindings(rowScope: Scope, row: SourceRow, variableNames?: string[]): void {
  for (const [k, v] of Object.entries(rowBindings(row, variableNames))) {
    rowScope.set(k, v);
  }
  // Auto-bind NValue/SValue/value_is_string only when variableNames doesn't
  // already place them (loadSubModules mirrors the 3 trailing source columns;
  // a right-to-left scan would then clobber them by picking up value_is_string).
  const namesLower = (variableNames ?? []).map((n) => n.toLowerCase());
  const trioAlreadyBound =
    namesLower.includes('nvalue') ||
    namesLower.includes('svalue') ||
    namesLower.includes('value_is_string');
  if (!trioAlreadyBound) {
    // TM1 view-source semantics: the value column is the first non-empty cell
    // scanning from the right (captured exports may pad rows with trailing
    // empty columns, so naively taking the LAST column would read `''`).
    let nVal: number | undefined;
    let sVal: string | undefined;
    for (let i = row.length - 1; i >= 0; i--) {
      const cell = row[i];
      if (cell === '' || cell === undefined || cell === null) continue;
      if (typeof cell === 'number') {
        nVal = cell;
        break;
      }
      const asNum = Number(String(cell).replace(',', '.'));
      if (Number.isFinite(asNum) && String(cell).trim() !== '') {
        nVal = asNum;
        break;
      }
      sVal = String(cell);
      break;
    }
    if (nVal !== undefined) {
      rowScope.set('NValue', nVal);
      rowScope.set('SValue', '');
      rowScope.set('value_is_string', 0);
    } else if (sVal !== undefined) {
      rowScope.set('NValue', 0);
      rowScope.set('SValue', sVal);
      rowScope.set('value_is_string', 1);
    } else {
      rowScope.set('NValue', 0);
      rowScope.set('SValue', '');
      rowScope.set('value_is_string', 0);
    }
  }
}

export function runProcess(input: RunInput): RunResult {
  const sections = input.sections;
  const output = new OutputCollector();
  const warnings: SimWarning[] = [];
  const parseErrors: RunResult['parseErrors'] = [];

  const scope = new Scope();
  if (input.parameters) {
    for (const [k, v] of Object.entries(input.parameters)) scope.set(k, v);
  }

  type ParsedSection = {
    section: Section;
    statements: ReturnType<typeof parseStatements>['statements'];
  };
  const parsed: ParsedSection[] = [];

  for (const s of SECTIONS) {
    const src = sections[s] ?? '';
    const r = parseStatements(src);
    for (const e of r.errors) parseErrors.push({ section: s, line: e.line, message: e.message });
    parsed.push({ section: s, statements: r.statements });
  }

  // Metadata pass — TM1 runs the Metadata section once PER source record (a full
  // pass before the Data pass). Export logic commonly lives here (per-row
  // TextOutput to a file), so it must be row-driven, not run a single time.
  runProcessSections({
    statements: (section) => parsed.find((q) => q.section === section)?.statements,
    ctx: (section, sectionScope) => ({
      scope: sectionScope,
      output,
      warnings,
      section,
      fixtures: input.fixtures,
      subProcessLoader: input.subProcessLoader,
    }),
    scope,
    rows: input.source?.rows,
    applyRow: (rowScope, row) => applyRowBindings(rowScope, row, input.variableNames),
    metadataPerRow: true,
  });

  // FINDING #5: cube cell-reads that missed the captured fixtures resolved to the
  // 0/'' fallback — indistinguishable from a real empty cell. Surface ONE
  // aggregated warning (not per-read) so the user can tell a correct 0 from a
  // missed/corrupt capture. Populated in-place by readCellN/readCellS.
  const missCount = input.fixtures?.cellReadMisses?.size ?? 0;
  if (missCount > 0) {
    warnings.push({
      message:
        `${missCount} cell read(s) had no captured value (resolved to 0/'') — ` +
        `re-capture the test or check coordinate/case; see cube-fixtures.jsonl.`,
    });
  }

  return { output, warnings, parseErrors };
}
