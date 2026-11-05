/**
 * TI datasource columns: merging `Variables` with `VariablesUIData`.
 *
 * TM1 keeps a datasource column list in TWO parallel properties, and neither one
 * alone is the whole truth (measured live on 11.8, 2026-08-29,
 * processVarsUiDataProbe.js + `processIgnoredVarsProbe.js`):
 *
 *   Variables         one entry per column the process actually USES
 *   VariablesUIData   one entry per SOURCE column, in column order
 *
 * A column set to Contents="Ignore" in Architect's Variables tab is absent from
 * `Variables` entirely — its name survives only inside the UIData entry:
 *
 *   "IgnoredInputVarName=vsSTRN\fVarType=32\fColType=1165\f"
 *
 * Fields are separated by U+000C (form feed), each one trailing. `ColType` 827 =
 * "Other" (a normal column), 1165 = "Ignore"; `VarType` 32 = String, 33 = Numeric.
 * On the live system exactly those two ColType values occur (1800× 827, 375× 1165)
 * and 25 of 328 processes carry ignored columns.
 *
 * The two lists NEVER re-sync on their own: a PATCH that sends `Variables` without
 * `VariablesUIData` leaves the old UIData standing, so adding or removing a
 * variable silently slides the ignore marks onto neighbouring columns (measured,
 * processIgnoreVarDriftProbe.js). Editors must therefore write BOTH
 * lists or neither — `splitVariableColumns` produces the matching pair.
 *
 * An entry is ALWAYS rebuilt canonically on write, never from a
 * carried-along raw form. Until 2026-08-30 `VariableColumn` carried a field `UiRaw`
 * for that. Re-measured (11.8, 2207 entries across 335 processes): **not a
 * single one** needs it — only the keys `IgnoredInputVarName`,
 * `VarType`, `ColType` occur, only the ColType values 827 and 1165, and every
 * entry separates with U+000C. So the field never triggered, but it sat in
 * every draft and every Git export as a foreign body in otherwise native
 * JSON. Price of the removal: a ColType beyond 827/1165 (Architect also knows, for
 * *Contents*, Element/Consolidation/Data/Attribute) is normalized
 * to 827 on save.
 *
 * vscode-free and side-effect-free: shared by `webviewClient/` and `commands/`,
 * neither of which may import the other.
 */

/** Wire shape of one entry in the REST `Variables` collection. */
export interface ProcessVariableWire {
  Name: string;
  Type: 'Numeric' | 'String';
  Position: number;
  StartByte?: number;
  EndByte?: number;
}

/**
 * One datasource column as the editor shows it — the merge of both TM1 lists.
 * `Ignored` columns exist only in `VariablesUIData`; the TI code cannot read them.
 */
export interface VariableColumn {
  Name: string;
  Type: 'Numeric' | 'String';
  Position: number;
  StartByte: number;
  EndByte: number;
  /** Contents = "Ignore" — column is skipped during processing. */
  Ignored?: boolean;
}

/** ColType = "Other" — a normal, processed column. */
export const COL_TYPE_OTHER = 827;
/** ColType = "Ignore" — column skipped during processing. */
export const COL_TYPE_IGNORE = 1165;
/** VarType inside UIData — String. */
export const VAR_TYPE_STRING = 32;
/** VarType inside UIData — Numeric. */
export const VAR_TYPE_NUMERIC = 33;

const FF = '\f';

/** One `key=value` pair of a UIData entry, in file order. */
export interface UiField { key: string; value: string; }

/**
 * Splits a UIData entry into its ordered fields. Tolerates both the live
 * separator (form feed) and a comma, which is what TM1py writes.
 */
export function parseUiEntry(entry: string): UiField[] {
  const out: UiField[] = [];
  for (const raw of String(entry ?? '').split(/[\f,]/)) {
    const part = raw.trim();
    if (!part) { continue; }
    const eq = part.indexOf('=');
    if (eq < 0) { out.push({ key: part, value: '' }); continue; }
    out.push({ key: part.slice(0, eq), value: part.slice(eq + 1) });
  }
  return out;
}

/** Serialises fields back into TM1's form: every pair followed by a form feed. */
export function serializeUiEntry(fields: UiField[]): string {
  return fields.map(f => `${f.key}=${f.value}${FF}`).join('');
}

function fieldValue(fields: UiField[], key: string): string | undefined {
  const hit = fields.find(f => f.key.toLowerCase() === key.toLowerCase());
  return hit ? hit.value : undefined;
}

function setField(fields: UiField[], key: string, value: string): UiField[] {
  const idx = fields.findIndex(f => f.key.toLowerCase() === key.toLowerCase());
  if (idx < 0) { return [...fields, { key, value }]; }
  const copy = fields.slice();
  copy[idx] = { key: copy[idx].key, value };
  return copy;
}

/** True when the UIData entry marks its column as ignored. */
export function isIgnoredUiEntry(entry: string): boolean {
  const fields = parseUiEntry(entry);
  if (fieldValue(fields, 'IgnoredInputVarName') !== undefined) { return true; }
  return Number(fieldValue(fields, 'ColType')) === COL_TYPE_IGNORE;
}

/**
 * Merges both TM1 lists into the full, ordered column list.
 *
 * Column order comes from `VariablesUIData`; a non-ignored entry consumes the
 * next `Variables` entry (sorted by Position). Positions of ignored columns are
 * derived from their neighbours rather than from the array index, so a process
 * whose positions have gaps still merges sanely.
 *
 * Without UIData (10 of 328 processes live, plus every process our own editor
 * created before this existed) every variable is a normal column.
 */
export function mergeVariableColumns(
  variables: ReadonlyArray<ProcessVariableWire> | undefined,
  uiData: ReadonlyArray<string> | undefined,
): VariableColumn[] {
  const vars = (variables ?? []).slice().sort((a, b) => (a.Position ?? 0) - (b.Position ?? 0));
  const ui = (uiData ?? []).map(s => String(s ?? ''));

  const asColumn = (v: ProcessVariableWire, pos: number, _raw?: string): VariableColumn => ({
    Name: String(v.Name ?? ''),
    Type: v.Type === 'Numeric' ? 'Numeric' : 'String',
    Position: pos,
    StartByte: Number(v.StartByte ?? 0),
    EndByte: Number(v.EndByte ?? 0),
  });

  if (ui.length === 0) {
    return vars.map((v, i) => asColumn(v, Number(v.Position) || i + 1));
  }

  const out: VariableColumn[] = [];
  let next = 0;
  let nextPos = 1;
  for (const entry of ui) {
    if (isIgnoredUiEntry(entry)) {
      const fields = parseUiEntry(entry);
      const col: VariableColumn = {
        Name: fieldValue(fields, 'IgnoredInputVarName') ?? '',
        Type: Number(fieldValue(fields, 'VarType')) === VAR_TYPE_NUMERIC ? 'Numeric' : 'String',
        Position: nextPos,
        StartByte: 0,
        EndByte: 0,
        Ignored: true,
      };
      out.push(col);
      nextPos++;
      continue;
    }
    const v = vars[next];
    if (!v) {
      // More UIData entries than variables — a length drift we cannot attribute.
      // Dropping the entry is the safe half: it carries no name of its own.
      continue;
    }
    next++;
    const pos = Number(v.Position) || nextPos;
    out.push(asColumn(v, pos, entry));
    nextPos = pos + 1;
  }

  // Variables the UIData never accounted for (drift the other way) must not be
  // lost — the editor would then delete them on the next save.
  for (; next < vars.length; next++) {
    const v = vars[next];
    const pos = Number(v.Position) || nextPos;
    out.push(asColumn(v, pos));
    nextPos = pos + 1;
  }
  return out;
}

/**
 * Turns the editor's column list back into the pair TM1 expects. Always emit both
 * halves together — see the drift note at the top of this file.
 */
export function splitVariableColumns(
  columns: ReadonlyArray<VariableColumn>,
): { Variables: Required<ProcessVariableWire>[]; VariablesUIData: string[] } {
  const Variables: Required<ProcessVariableWire>[] = [];
  const VariablesUIData: string[] = [];

  for (const c of columns) {
    const type: 'Numeric' | 'String' = c.Type === 'Numeric' ? 'Numeric' : 'String';
    const name = String(c.Name ?? '');
    let fields: UiField[] = [];
    fields = setField(fields, 'VarType', String(type === 'Numeric' ? VAR_TYPE_NUMERIC : VAR_TYPE_STRING));

    if (c.Ignored) {
      // The name of an ignored column lives ONLY here — Variables never sees it.
      fields = setField(fields, 'IgnoredInputVarName', name);
      // Reorder so the ignored name leads, matching what TM1 itself writes.
      const lead = fields.filter(f => f.key.toLowerCase() === 'ignoredinputvarname');
      const rest = fields.filter(f => f.key.toLowerCase() !== 'ignoredinputvarname');
      fields = [...lead, ...rest];
      fields = setField(fields, 'ColType', String(COL_TYPE_IGNORE));
    } else {
      fields = setField(fields, 'ColType', String(COL_TYPE_OTHER));
      Variables.push({
        Name: name,
        Type: type,
        Position: Number(c.Position) || Variables.length + 1,
        StartByte: Number(c.StartByte ?? 0),
        EndByte: Number(c.EndByte ?? 0),
      });
    }
    VariablesUIData.push(serializeUiEntry(fields));
  }

  return { Variables, VariablesUIData };
}
