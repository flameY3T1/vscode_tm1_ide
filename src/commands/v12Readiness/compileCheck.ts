import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { apiRequest } from '../../tm1Rest/client';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { isOk } from '../../tm1Rest/httpError';
import { PROC_SECTIONS, type CompileFailure, type CompileResult, type ProcSection, type SourceProcess } from '../../v12Readiness/types';

/** Name of the throw-away process the compiler sees. `CompileProcess` saves nothing (measured: 404 afterwards). */
const PROBE_NAME = '}VSCode_Readiness_Compile';

const MAX_CONSECUTIVE_HTTP_ERRORS = 10;

const SECTION_BY_PROCEDURE: Record<string, ProcSection> = { Prolog: 'prolog', Metadata: 'metadata', Data: 'data', Epilog: 'epilog' };

/**
 * Dry-compiles every v11 process on a connected TM1 12 database (`POST /CompileProcess`).
 * Catches what a list of names cannot: syntax the v12 parser reads differently, variables it
 * resolves differently. Measured 2026-10-07: 366 processes of the 11.8 test server compiled on
 * 12.5.9 in 0.7 s; 49 rejected, 47 of them already found by the rules.
 *
 * The data source is sent as `None`: a v11 file or ODBC source does not exist on the target and
 * is a finding of its own. Variables and parameters go along so their names resolve — each
 * variable WITH its `Position`: without it 12.5.9 refuses every call with `400 code 114
 * ObjectPropertyValueInvalid` (measured 2026-10-07; the first click test died on it).
 */
export async function compileOnV12(
  processes: SourceProcess[],
  target: Tm1Config,
  server: string,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<CompileResult> {
  const failures: CompileFailure[] = [];
  const notCheckable: string[] = [];
  let checked = 0;
  let consecutiveHttpErrors = 0;
  let version: string | undefined;
  try {
    const v = await apiRequest('GET', 'Configuration?$select=ProductVersion', undefined, undefined, target);
    if (isOk(v)) { version = parseBodySafe<{ ProductVersion?: string }>(v, {}).ProductVersion; }
  } catch { /* cosmetic */ }

  for (const p of processes) {
    if (token.isCancellationRequested) { break; }
    if (checked % 25 === 0) {
      progress.report({ message: `${checked} / ${processes.length}`, increment: (25 / Math.max(processes.length, 1)) * 100 });
    }
    const body = JSON.stringify({ Process: {
      Name: PROBE_NAME,
      PrologProcedure: p.code.prolog, MetadataProcedure: p.code.metadata,
      DataProcedure: p.code.data, EpilogProcedure: p.code.epilog,
      DataSource: { Type: 'None' },
      // A neutral value per type: the compiler derives the type from it, the real default stays here.
      Parameters: (p.parameters ?? []).map(x => ({ ...x, Value: x.Type === 'Numeric' ? 0 : '' })),
      Variables: p.variables ?? [],
    } });
    const res = await apiRequest('POST', 'CompileProcess', body, 60_000, target);
    // A refused request is not a compile error: the process counts as "not checkable". One
    // such process is no reason to stop; ten in a row mean the request itself is wrong (or
    // the server is) — then stop instead of firing the rest at it.
    if (!isOk(res)) {
      notCheckable.push(p.name);
      if (++consecutiveHttpErrors >= MAX_CONSECUTIVE_HTTP_ERRORS) {
        throw new Error(`CompileProcess HTTP ${res.statusCode} for ${MAX_CONSECUTIVE_HTTP_ERRORS} processes in a row (last: "${p.name}")`);
      }
      continue;
    }
    consecutiveHttpErrors = 0;
    checked++;
    type SyntaxError = { Procedure?: string; LineNumber?: number; Message?: string };
    for (const err of parseBodySafe<{ value?: SyntaxError[] }>(res, {}).value ?? []) {
      failures.push({
        process: p.name,
        section: SECTION_BY_PROCEDURE[err.Procedure ?? ''] ?? PROC_SECTIONS[0],
        // The compiler counts from 1, the report from 0.
        line: Math.max(0, (err.LineNumber ?? 1) - 1),
        message: err.Message ?? '',
      });
    }
  }
  return { server, ...(version ? { version } : {}), checked, failures, notCheckable, partial: checked + notCheckable.length < processes.length };
}
