import type { Tm1Config } from '../tm1Rest/transport/types';
import type { TM1Process } from './serializer';
import { splitVariableColumns } from '../utils/processVariablesUi';
import { upsertProcess } from '../tm1Rest/processApi';

/**
 * The column lists for the push — three layers, because the repo can hold three
 * kinds of header files and a wrong `VariablesUIData` does real damage:
 * TM1 never reconciles the two lists, so a `[]` deletes the
 * ignore markers on the server.
 *
 * 1. Header carries `VariablesUIData` (since 2026-08-30): pass both lists on
 *    verbatim — they belong together and came from the server that way.
 * 2. No `VariablesUIData`, but variables with `Ignored` (this is how the
 *    mirror wrote after saving in the process editor): build the pair from that.
 * 3. Neither (old header files from the fetch path): send only `Variables`
 *    and leave the server list alone. Incomplete, but harmless —
 *    an invented `VariablesUIData` would not be.
 */
export function buildVariablePayload(p: TM1Process): Record<string, unknown> {
  const variables = p.variables ?? [];
  if (p.variablesUiData !== undefined) {
    return { Variables: variables, VariablesUIData: p.variablesUiData };
  }
  if (variables.some(v => (v as { Ignored?: boolean }).Ignored)) {
    const split = splitVariableColumns(variables as Parameters<typeof splitVariableColumns>[0]);
    return { Variables: split.Variables, VariablesUIData: split.VariablesUIData };
  }
  return { Variables: variables };
}

function buildPatchPayload(p: TM1Process): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    PrologProcedure:   p.prolog,
    MetadataProcedure: p.metadata,
    DataProcedure:     p.data,
    EpilogProcedure:   p.epilog,
    // Always send Variables — empty array clears old variables.
    ...buildVariablePayload(p),
  };
  if (p.dataSource) { payload.DataSource = p.dataSource; }
  // `undefined` means "do not touch", `[]` means "remove all" — exactly
  // like `Variables` next to it. Until 2026-08-31 this said `length > 0`, so
  // a parameter list emptied in the repo NEVER reached the server and the push
  // reported success anyway. Measured live: PATCH with `Parameters` replaces the
  // list, `Parameters: []` really empties it, without the field it stays untouched.
  if (p.parameters !== undefined) { payload.Parameters = p.parameters; }
  // Restore the process "Security access" flag (full access regardless of the
  // executing user). The serializer always parses hasSecurity from the header
  // (HasSecurityAccess top-level, falling back to legacy uiState.hasSecurity),
  // so it is defined for any git-managed process; older headers default to false.
  if (p.hasSecurity !== undefined) { payload.HasSecurityAccess = !!p.hasSecurity; }
  // A PATCH without `UIData` leaves the server value alone, a POST does not
  // create it — so the wizard state is lost exactly where a
  // push creates the process NEW on a target server. `undefined` still
  // means "do not touch".
  if (p.uiData !== undefined) { payload.UIData = p.uiData; }
  return payload;
}

/** Pushes `p`; returns the ETag of the version now on the server. `ifMatch`: see `upsertProcess`. */
export function pushProcess(p: TM1Process, config: Tm1Config, ifMatch?: string): Promise<string | undefined> {
  return upsertProcess(config, p.name, buildPatchPayload(p), ifMatch);
}
