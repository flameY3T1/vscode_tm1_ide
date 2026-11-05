/**
 * Parse the raw TextOutput log file written by a rewritten clone-process.
 *
 * TM1 TextOutput emits one CSV-like line per call:
 *   <op><delim><arg1>...<delim><argN>
 * Delimiter is `,` (US) or `;` (German locale); auto-detected from first
 * non-empty line. Strings containing the delimiter or `"` are wrapped in
 * double quotes; embedded quotes are doubled. Unknown / malformed lines
 * are reported as warnings, not thrown.
 */

import type { LogRow } from './logSchema';
import { KNOWN_OPS, META_OPS } from './logSchema';
import { splitPreFormattedRow, PREFORMATTED_ROW_OPS } from './preformattedRowSplit';

export type ParseWarning = { line: number; message: string; raw: string };

export type ParseResult = {
  rows: LogRow[];
  warnings: ParseWarning[];
  hasStart: boolean;
  hasEnd: boolean;
};

/**
 * CSV-line parser honoring "..." quoted fields with "" embedded-quote escape.
 * `tm1Quirks` (default) also tolerates TM1's malformed ASCIIOutput quoting;
 * pass `false` for standard CSV, where those heuristics shift columns
 * (`"a"",b",42` must stay two fields).
 */
export function parseCsvLine(line: string, delim: string = ',', tm1Quirks = true): string[] {
  const fields: string[] = [];
  let buf = '';
  let inQuote = false;
  let fieldStarted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inQuote) {
      if (c === '"') {
        if (!tm1Quirks) {
          if (line[i + 1] === '"') { buf += '"'; i++; } else { inQuote = false; }
          continue;
        }
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
          // TM1's ASCIIOutput writes a single-quote value as `"""` (3 chars
          // total: open, literal, close) instead of standard CSV `""""`
          // (open, escape-pair, close). Detect the malformed form: after the
          // escape pair, if the next char is the delim or end-of-line, close
          // the field implicitly so subsequent fields don't get consumed.
          const after = line[i + 1];
          if (after === undefined || after === delim) {
            inQuote = false;
          }
          continue;
        }
        // Single '"': TM1's ASCIIOutput closes a field only when the quote is
        // followed by the delimiter or end-of-line. An embedded '"' (e.g. the
        // quotes inside an MDX pattern like `…, "SITE2024_A12_C")`) is NOT escaped
        // by TM1 — treat it as literal content and stay in the field, otherwise
        // the field is truncated and the leading quote is dropped.
        {
          const nxt = line[i + 1];
          if (nxt === undefined || nxt === delim) {
            inQuote = false;
          } else {
            buf += '"';
          }
        }
        continue;
      }
      buf += c;
      continue;
    }

    if (!fieldStarted && c === '"') {
      inQuote = true;
      fieldStarted = true;
      continue;
    }

    if (c === delim) {
      fields.push(buf);
      buf = '';
      fieldStarted = false;
      continue;
    }

    buf += c;
    fieldStarted = true;
  }

  fields.push(buf);
  return fields;
}

/**
 * Delimiter of a line that opens with a quoted field: the character right
 * after that field's closing quote. TM1's ASCIIOutput/TextOutput quote every
 * field and separate with the process's `DatasourceASCIIDelimiter`, which a
 * process may set to anything — a production process set `CHAR(35)` (`#`),
 * and both its captured log and its source dump came out `#`-separated
 * (2026-11-03). `null` when the line does not open that way.
 */
export function quotedLineDelim(line: string): string | null {
  if (line[0] !== '"') return null;
  for (let i = 1; i < line.length; i++) {
    if (line[i] !== '"') continue;
    if (line[i + 1] === '"') { i++; continue; }
    const d = line[i + 1];
    // Letters, digits or blanks after a quote mean TM1's malformed quoting, not a delimiter.
    return d === undefined || /[\p{L}\p{N}\s]/u.test(d) ? null : d;
  }
  return null;
}

/**
 * Pick the delim for a single line: the one after a leading quoted field,
 * else count `;` vs `,` outside quotes. Falls back to the file-wide default
 * when both counts are zero.
 */
function pickLineDelim(line: string, fallback: string): string {
  const quoted = quotedLineDelim(line);
  if (quoted !== null) return quoted;
  let semi = 0;
  let comma = 0;
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (inQ) continue;
    if (c === ';') semi++;
    else if (c === ',') comma++;
  }
  if (semi === 0 && comma === 0) return fallback;
  return semi > comma ? ';' : ',';
}

/** Detect delim from first non-empty line: the one after a leading quoted
 *  field, else prefer `;` when it outweighs `,`. */
function detectDelim(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const quoted = quotedLineDelim(line);
    if (quoted !== null) return quoted;
    // Count quoted-aware delim occurrences for `,` and `;` and pick the winner.
    const count = (delim: ',' | ';'): number => {
      let n = 0;
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQ && line[i + 1] === '"') { i++; continue; }
          inQ = !inQ;
          continue;
        }
        if (!inQ && c === delim) n++;
      }
      return n;
    };
    const semi = count(';');
    const comma = count(',');
    return semi > comma ? ';' : ',';
  }
  return ',';
}

function parseNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n;
  // German-locale: decimal comma. Accept "615,39" → 615.39 when no dot is
  // present (avoid mis-parsing thousand-grouped values like "1,234.56").
  // Mirrors csvSource.parseDeNumber so log values stay symmetric with the
  // CSV-source values the simulator reads.
  if (!trimmed.includes('.') && /,/.test(trimmed)) {
    const swapped = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(swapped)) return swapped;
  }
  return null;
}

function buildRow(op: string, args: string[]): LogRow | null {
  switch (op) {
    case 'CellPutN': {
      if (args.length < 2) return null;
      const value = parseNumber(args[args.length - 1]);
      if (value === null) return null;
      const cube = args[0];
      const coord = args.slice(1, -1);
      return { op: 'CellPutN', cube, coord, value };
    }
    case 'CellIncrementN': {
      if (args.length < 2) return null;
      const value = parseNumber(args[args.length - 1]);
      if (value === null) return null;
      const cube = args[0];
      const coord = args.slice(1, -1);
      return { op: 'CellIncrementN', cube, coord, value };
    }
    case 'CellPutS': {
      if (args.length < 2) return null;
      const value = args[args.length - 1];
      const cube = args[0];
      const coord = args.slice(1, -1);
      return { op, cube, coord, value };
    }
    case 'DimElementInsert': {
      if (args.length < 5) return null;
      const [dim, hier, name, type, insertAfter] = args;
      return { op, dim, hier, name, type, insertAfter };
    }
    case 'DimElementDelete': {
      if (args.length < 3) return null;
      const [dim, hier, name] = args;
      return { op, dim, hier, name };
    }
    case 'DimElementComponentAdd': {
      if (args.length < 5) return null;
      const [dim, hier, parent, child, w] = args;
      const weight = parseNumber(w);
      if (weight === null) return null;
      return { op, dim, hier, parent, child, weight };
    }
    case 'DimElementComponentDelete': {
      if (args.length < 4) return null;
      const [dim, hier, parent, child] = args;
      return { op, dim, hier, parent, child };
    }
    case 'AttrPutS': {
      if (args.length < 5) return null;
      const [dim, hier, element, attribute, value] = args;
      return { op, dim, hier, element, attribute, value };
    }
    case 'AttrPutN': {
      if (args.length < 5) return null;
      const [dim, hier, element, attribute, v] = args;
      const value = parseNumber(v);
      if (value === null) return null;
      return { op, dim, hier, element, attribute, value };
    }
    case 'AttrInsert': {
      if (args.length < 6) return null;
      const [dim, hier, element, attribute, type, prevAttr] = args;
      return { op, dim, hier, element, attribute, type, prevAttr };
    }
    case 'AttrDelete': {
      if (args.length < 4) return null;
      const [dim, hier, element, attribute] = args;
      return { op, dim, hier, element, attribute };
    }
    // ── Object-type attribute schema (no instance args) ────────────────────
    case 'CubeAttrInsert':
    case 'DimensionAttrInsert':
    case 'ChoreAttrInsert':
    case 'ViewAttrInsert':
    case 'SubsetAttrInsert': {
      if (args.length < 3) return null;
      const [prevAttr, attribute, type] = args;
      return { op, prevAttr, attribute, type } as LogRow;
    }
    case 'CubeAttrDelete':
    case 'DimensionAttrDelete':
    case 'ChoreAttrDelete':
    case 'ViewAttrDelete':
    case 'SubsetAttrDelete': {
      if (args.length < 1) return null;
      return { op, attribute: args[0] } as LogRow;
    }
    case 'HierarchySubsetAttrInsert': {
      if (args.length < 5) return null;
      const [dim, hier, subset, attribute, type] = args;
      return { op, dim, hier, subset, attribute, type };
    }
    case 'HierarchySubsetAttrDelete': {
      if (args.length < 4) return null;
      const [dim, hier, subset, attribute] = args;
      return { op, dim, hier, subset, attribute };
    }
    case 'SubsetCreate': {
      if (args.length < 3) return null;
      const [dim, hier, subset] = args;
      return { op: 'SubsetCreate', dim, hier, subset };
    }
    case 'SubsetDeleteAllElements': {
      if (args.length < 3) return null;
      const [dim, hier, subset] = args;
      return { op: 'SubsetDeleteAllElements', dim, hier, subset };
    }
    case 'SubsetCreateByMDX': {
      if (args.length < 3) return null;
      const [dim, hier, mdx] = args;
      return { op, dim, hier, mdx };
    }
    case 'SubsetElementInsert': {
      if (args.length < 5) return null;
      const [dim, hier, subset, element, p] = args;
      const position = parseNumber(p);
      if (position === null) return null;
      return { op, dim, hier, subset, element, position };
    }
    case 'SubsetElementDelete': {
      if (args.length < 4) return null;
      const [dim, hier, subset, element] = args;
      return { op, dim, hier, subset, element };
    }
    case 'ViewCreate': {
      if (args.length < 2) return null;
      const [cube, view] = args;
      return { op: 'ViewCreate', cube, view };
    }
    case 'ViewZeroOut': {
      if (args.length < 2) return null;
      const [cube, view] = args;
      return { op: 'ViewZeroOut', cube, view };
    }
    case 'CubeCreate': {
      if (args.length < 1) return null;
      const [name, ...dimensions] = args;
      return { op: 'CubeCreate', name, dimensions };
    }
    case 'DimensionCreate': {
      if (args.length < 1) return null;
      const [name] = args;
      return { op: 'DimensionCreate', name };
    }
    case 'DimensionDestroy': {
      if (args.length < 1) return null;
      return { op: 'DimensionDestroy', name: args[0] };
    }
    case 'HierarchyCreate': {
      if (args.length < 2) return null;
      return { op: 'HierarchyCreate', dim: args[0], hier: args[1] };
    }
    case 'HierarchyDestroy': {
      if (args.length < 2) return null;
      return { op: 'HierarchyDestroy', dim: args[0], hier: args[1] };
    }
    case 'CubeDestroy': {
      if (args.length < 1) return null;
      return { op: 'CubeDestroy', name: args[0] };
    }
    case 'CubeDelete': {
      if (args.length < 1) return null;
      return { op: 'CubeDelete', name: args[0] };
    }
    case 'CubeRuleDestroy': {
      if (args.length < 1) return null;
      return { op: 'CubeRuleDestroy', name: args[0] };
    }
    case 'RuleDestroy': {
      if (args.length < 1) return null;
      return { op: 'RuleDestroy', name: args[0] };
    }
    case 'ViewDelete': {
      if (args.length < 2) return null;
      return { op: 'ViewDelete', cube: args[0], view: args[1] };
    }
    case 'ViewDestroy': {
      if (args.length < 2) return null;
      return { op: 'ViewDestroy', cube: args[0], view: args[1] };
    }
    case 'ViewMDXSet': {
      if (args.length < 3) return null;
      return { op: 'ViewMDXSet', cube: args[0], view: args[1], mdx: args[2] };
    }
    case 'ViewSuppressZeroesSet':
    case 'ViewZeroSuppressionSet': {
      if (args.length < 3) return null;
      const flag = parseNumber(args[2]);
      if (flag === null) return null;
      return { op, cube: args[0], view: args[1], flag } as LogRow;
    }
    case 'ViewRowDimensionSet':
    case 'ViewColumnDimensionSet':
    case 'ViewTitleDimensionSet': {
      if (args.length < 4) return null;
      const position = parseNumber(args[3]);
      if (position === null) return null;
      return { op, cube: args[0], view: args[1], dim: args[2], position } as LogRow;
    }
    case 'ViewTitleElementSet': {
      if (args.length < 4) return null;
      return {
        op: 'ViewTitleElementSet',
        cube: args[0],
        view: args[1],
        dim: args[2],
        element: args[3],
      };
    }
    case 'ViewSubsetAssign': {
      if (args.length < 4) return null;
      return {
        op: 'ViewSubsetAssign',
        cube: args[0],
        view: args[1],
        dim: args[2],
        subset: args[3],
      };
    }
    case 'ViewExtractSkipCalcsSet':
    case 'ViewExtractSkipConsolidatedValuesSet':
    case 'ViewExtractSkipConsolidatedStringsSet':
    case 'ViewExtractSkipRuleValuesSet':
    case 'ViewExtractSkipZeroesSet': {
      if (args.length < 3) return null;
      const skip = parseNumber(args[2]);
      if (skip === null) return null;
      return { op, cube: args[0], view: args[1], skip } as LogRow;
    }
    case 'ViewStructUpdate': {
      if (args.length < 2) return null;
      return { op: 'ViewStructUpdate', cube: args[0], view: args[1] };
    }
    case 'CellSecurityCubeCreate': {
      if (args.length < 1) return null;
      return { op: 'CellSecurityCubeCreate', name: args[0] };
    }
    case 'CellSecurityCubeDestroy': {
      if (args.length < 1) return null;
      return { op: 'CellSecurityCubeDestroy', name: args[0] };
    }
    case 'CubeDataReservationRelease': {
      if (args.length < 1) return null;
      const [name, ...elements] = args;
      return { op: 'CubeDataReservationRelease', name, elements };
    }
    case 'CubeDRRelease': {
      if (args.length < 2) return null;
      return { op: 'CubeDRRelease', name: args[0], elementList: args[1] };
    }
    case 'HierarchyElementSecurityPut': {
      if (args.length < 5) return null;
      return {
        op: 'HierarchyElementSecurityPut',
        dim: args[0],
        hier: args[1],
        element: args[2],
        group: args[3],
        level: args[4],
      };
    }
    case 'TranSave': {
      if (args.length < 1) return null;
      return { op: 'TranSave', transactionId: args[0] };
    }
    case 'TranDelete': {
      if (args.length < 1) return null;
      return { op: 'TranDelete', transactionId: args[0] };
    }
    case 'SubsetDestroy': {
      if (args.length < 3) return null;
      return { op: 'SubsetDestroy', dim: args[0], hier: args[1], subset: args[2] };
    }
    case 'SubsetMDXSet': {
      if (args.length < 4) return null;
      return { op: 'SubsetMDXSet', dim: args[0], hier: args[1], subset: args[2], mdx: args[3] };
    }
    case 'SubsetIsAllSet': {
      if (args.length < 4) return null;
      const flag = parseNumber(args[3]);
      if (flag === null) return null;
      return { op: 'SubsetIsAllSet', dim: args[0], hier: args[1], subset: args[2], flag };
    }
    case 'SubsetAliasSet': {
      if (args.length < 4) return null;
      return {
        op: 'SubsetAliasSet',
        dim: args[0],
        hier: args[1],
        subset: args[2],
        alias: args[3],
      };
    }
    case '__CALL__': {
      if (args.length < 2) return null;
      const callee = args[0];
      const callIndex = Number(args[1]);
      if (!Number.isFinite(callIndex)) return null;
      const params: Array<[string, string]> = [];
      for (let i = 2; i + 1 < args.length; i += 2) {
        params.push([args[i], args[i + 1]]);
      }
      return { op: '__CALL__', callee, callIndex, params };
    }
    case '__PARAM__': {
      if (args.length < 3) return null;
      const [name, type, raw] = args;
      if (type === 'N') {
        const n = parseNumber(raw);
        if (n === null) return null;
        return { op: '__PARAM__', name, type: 'N', value: n };
      }
      return { op: '__PARAM__', name, type: 'S', value: raw };
    }
    case '__SUB_LIVE_FALLBACK__': {
      if (args.length < 2) return null;
      const line = Number(args[0]);
      if (!Number.isFinite(line)) return null;
      return { op: '__SUB_LIVE_FALLBACK__', line, reason: args[1] };
    }
    default:
      // Schicht-2 meta-ops: any KNOWN op without a typed handler is logged as
      // a `GenericMetaRow` (op + raw args). Diff treats these as opaque tuples.
      if (META_OPS.has(op)) {
        // Bedrock-style `TextOutput(file, Expand(row))` writes one ASCIIOutput
        // field for the whole row, so the captured args land as
        // `[file, "v1;v2;v3"]`. The simulator's op-emitter splits these into
        // separate fields; mirror that here so the diff aligns. Same for
        // `__ASCIIOUTPUT__` / `__SETOUTPUTCHARSET__`.
        if (PREFORMATTED_ROW_OPS.has(op)) {
          const flat: string[] = [];
          for (const a of args) {
            const split = splitPreFormattedRow(a);
            if (split.length > 1) flat.push(...split);
            else flat.push(a);
          }
          return { op, args: flat };
        }
        return { op, args: [...args] };
      }
      return null;
  }
}

/**
 * Split a capture log into records. TM1's ASCIIOutput quotes every field and
 * writes a value's own line breaks verbatim, so a value with a newline (rule
 * text via CubeRuleGet, a multi-line note) spans several physical lines. A
 * record that opens with `"` is complete only once a physical line ends in
 * `"`; until then the next line belongs to it (joined with LF, the break the
 * value held — measured on 11.8, 2026-10-19).
 * TM1 does not escape a literal `"`, so a value whose line ends in one right
 * before its break looks closed. A following line that cannot start a record
 * (not quoted, no known op or `__` marker first) is therefore still joined.
 * ponytail: a continuation line that itself starts with `"` or an op name
 * stays ambiguous; escaping in the capture would be the real fix.
 */
function canStartRecord(line: string): boolean {
  if (line.startsWith('"')) return true;
  const first = /^[^,;]*/.exec(line)![0].trim();
  return first.startsWith('__') || KNOWN_OPS.has(first);
}

export function splitLogRecords(text: string): string[] {
  const out: string[] = [];
  let open: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (open !== undefined) {
      open += '\n' + line;
      if (line.endsWith('"')) { out.push(open); open = undefined; }
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.startsWith('"') && line.trim() !== '' && !canStartRecord(line)) {
      out[out.length - 1] = prev + '\n' + line;
      if (!line.endsWith('"')) { open = out.pop(); }
      continue;
    }
    if (line.startsWith('"') && !line.endsWith('"')) { open = line; continue; }
    out.push(line);
  }
  if (open !== undefined) out.push(open);
  return out;
}

export function parseLog(content: string): ParseResult {
  const lines = splitLogRecords(content);
  const rows: LogRow[] = [];
  const warnings: ParseWarning[] = [];
  let hasStart = false;
  let hasEnd = false;
  const fileDelim = detectDelim(content);

  // Records can span lines (values with line breaks); warnings name the physical line.
  let nextLine = 1;
  for (const line of lines) {
    const lineNo = nextLine;
    nextLine += line.split('\n').length;
    if (line.trim() === '') continue;

    // Per-line delim detection. The rewriter's __CALL__ / __PARAM__ markers
    // are emitted by TM1's ASCIIOutput with quoting (commas), while in-process
    // ASCIIOutput rewrites (__TEXTOUTPUT__, __SETOUTPUTCHARSET__, etc.) may
    // appear as semicolon-delimited unquoted rows in the same file. Detecting
    // per-line avoids dropping every body row when both styles co-exist.
    const lineDelim = pickLineDelim(line, fileDelim);

    const fields = parseCsvLine(line, lineDelim);
    if (fields.length === 0) continue;

    const op = fields[0];
    if (op === '__START__' || op === '__SECTION_START__') {
      hasStart = true;
      continue;
    }
    if (op === '__END__' || op === '__SECTION_END__') {
      hasEnd = true;
      continue;
    }

    // Runtime read-captures are consumed separately (extractCellReads → cube
    // fixtures, extractAttrReads → attr fixtures); they are not write-op diff
    // rows, so skip without warning.
    if (op === '__CELLREAD__') continue;
    if (op === '__ATTRREAD__') continue;
    if (op === '__RULEREAD__') continue;

    if (!KNOWN_OPS.has(op)) {
      warnings.push({ line: lineNo, message: `unknown op '${op}'`, raw: line });
      continue;
    }

    const row = buildRow(op, fields.slice(1));
    if (!row) {
      warnings.push({
        line: lineNo,
        message: `malformed row for op '${op}' (insufficient or invalid args)`,
        raw: line,
      });
      continue;
    }
    rows.push(row);
  }

  return { rows, warnings, hasStart, hasEnd };
}

/** A runtime cell read captured by instrumentReads' `__CELLREAD__` marker. */
export type CellReadCapture = { cube: string; coord: string[]; value: number | string };

/** Result of {@link extractCellReadsWithStats}: parseable captures + a count of
 *  captures dropped because their numeric value could not be disambiguated. */
export type CellReadExtraction = { captures: CellReadCapture[]; droppedCount: number };

/**
 * Extract runtime read-captures from a capture log, reporting how many were
 * dropped. A numeric read (retType `N`) whose value `parseNumber` refuses to
 * disambiguate (e.g. "1.234,56" — both `.` and `,`) is DROPPED, not coerced to
 * a plausible-but-wrong `0`: emitting a bogus fixture cell would silently
 * corrupt every later Simulate. `droppedCount` lets the caller surface a
 * warning that the capture was imperfect. Line layout:
 *   __CELLREAD__ , <retType N|S> , <cube> , <coord1..coordN> , <value>
 */
export function extractCellReadsWithStats(text: string): CellReadExtraction {
  const fileDelim = detectDelim(text);
  const captures: CellReadCapture[] = [];
  let droppedCount = 0;
  for (const raw of splitLogRecords(text)) {
    if (raw.trim() === '') continue;
    const fields = parseCsvLine(raw, pickLineDelim(raw, fileDelim));
    if (fields[0] !== '__CELLREAD__' || fields.length < 5) continue;
    const retType = fields[1];
    const cube = fields[2];
    const coord = fields.slice(3, fields.length - 1);
    const rawValue = fields[fields.length - 1];
    if (retType === 'N') {
      const parsed = parseNumber(rawValue);
      if (parsed === null) {
        // Ambiguous numeric — drop rather than write a wrong `0` fixture cell.
        droppedCount++;
        continue;
      }
      captures.push({ cube, coord, value: parsed });
    } else {
      captures.push({ cube, coord, value: rawValue });
    }
  }
  return { captures, droppedCount };
}

/** Result of {@link buildCubeFixturesJsonl}: JSONL body + count of ambiguous
 *  numeric reads dropped from the capture (caller warns when > 0) + count of
 *  coordinates whose captured value CHANGED across the run (temporal variation
 *  that keep-last dedup silently hides; caller warns when > 0). */
export type CubeFixturesResult = { jsonl: string; droppedCount: number; conflictCount: number };

/**
 * Turn a capture log's `__CELLREAD__` markers into `cube-fixtures.jsonl`
 * content (one `{cube,coord,value}` object per line). Repeated coordinates are
 * de-duped keeping the LAST captured value (matches a live run's final read).
 * `jsonl` is '' when the log has no captures (caller can skip writing the file).
 * `droppedCount` reports ambiguous numeric reads that were dropped rather than
 * written as wrong `0` cells — caller should warn the user when > 0.
 * `conflictCount` reports DISTINCT coordinates that were read more than once
 * with a CHANGING value (external write, rule recompute, or the process's own
 * earlier write — capture runs live). Keep-last dedup keeps only the final value,
 * so a replay reading such a coord at an earlier call site silently gets the
 * later value — caller should warn the user when > 0.
 */
export function buildCubeFixturesJsonl(logText: string): CubeFixturesResult {
  const { captures, droppedCount } = extractCellReadsWithStats(logText);
  const byKey = new Map<string, CellReadCapture>();
  const conflictKeys = new Set<string>();
  for (const c of captures) {
    const key = `${c.cube}\t${c.coord.join('\t')}`;
    const prev = byKey.get(key);
    // String-compare the serialized value: same key seen again with a DIFFERENT
    // value = a temporal conflict. Track distinct conflicting keys (a key with
    // three distinct values still counts once). Keep-last behaviour unchanged.
    if (prev !== undefined && JSON.stringify(prev.value) !== JSON.stringify(c.value)) {
      conflictKeys.add(key);
    }
    byKey.set(key, c);
  }
  const jsonl =
    byKey.size === 0 ? '' : [...byKey.values()].map((c) => JSON.stringify(c)).join('\n') + '\n';
  return { jsonl, droppedCount, conflictCount: conflictKeys.size };
}

/** A runtime object-level attribute read captured by instrumentReads'
 *  `__ATTRREAD__` marker. `fn` is the lowercased function name; `args` are the
 *  resolved object-id / attribute / locale args in call order. */
export type AttrReadCapture = { fn: string; args: string[]; value: number | string };

/** Result of {@link extractAttrReadsWithStats}: parseable captures + a count of
 *  captures dropped because their numeric value could not be disambiguated. */
export type AttrReadExtraction = { captures: AttrReadCapture[]; droppedCount: number };

/**
 * Extract runtime attribute-read captures from a capture log, reporting how many
 * were dropped. A numeric read (retType `N`) whose value `parseNumber` refuses to
 * disambiguate is DROPPED rather than coerced to a wrong `0` (mirrors
 * {@link extractCellReadsWithStats}). Line layout:
 *   __ATTRREAD__ , <retType N|S> , <FuncName> , <arg1..argN> , <value>
 */
export function extractAttrReadsWithStats(text: string): AttrReadExtraction {
  const fileDelim = detectDelim(text);
  const captures: AttrReadCapture[] = [];
  let droppedCount = 0;
  for (const raw of splitLogRecords(text)) {
    if (raw.trim() === '') continue;
    const fields = parseCsvLine(raw, pickLineDelim(raw, fileDelim));
    // marker , retType , funcName , >=1 arg , value → at least 5 fields.
    if (fields[0] !== '__ATTRREAD__' || fields.length < 5) continue;
    const retType = fields[1];
    const fn = fields[2].toLowerCase();
    const args = fields.slice(3, fields.length - 1);
    const rawValue = fields[fields.length - 1];
    if (retType === 'N') {
      const parsed = parseNumber(rawValue);
      if (parsed === null) {
        // Ambiguous numeric — drop rather than write a wrong `0` attr fixture.
        droppedCount++;
        continue;
      }
      captures.push({ fn, args, value: parsed });
    } else {
      captures.push({ fn, args, value: rawValue });
    }
  }
  return { captures, droppedCount };
}

/** Result of {@link buildAttrReadsJsonl}: JSONL body + count of ambiguous numeric
 *  reads dropped from the capture (caller warns when > 0). */
export type AttrReadsResult = { jsonl: string; droppedCount: number };

/**
 * Turn a capture log's `__ATTRREAD__` markers into `attr-reads.jsonl` content
 * (one `{fn,args,value}` object per line). Repeated keys (`fn` + args) are
 * de-duped keeping the LAST captured value. The simulator looks these up by
 * `${fn.toLowerCase()}\t${args.join('\t')}`, so the emitted args are the resolved
 * arg strings in call order. `jsonl` is '' when the log has no captures (caller
 * can skip writing the file). `droppedCount` reports ambiguous numeric reads that
 * were dropped rather than written as wrong `0` values — caller should warn when > 0.
 */
export function buildAttrReadsJsonl(logText: string): AttrReadsResult {
  const { captures, droppedCount } = extractAttrReadsWithStats(logText);
  const byKey = new Map<string, AttrReadCapture>();
  for (const c of captures) {
    const key = `${c.fn}\t${c.args.join('\t')}`;
    byKey.set(key, c);
  }
  const jsonl =
    byKey.size === 0 ? '' : [...byKey.values()].map((c) => JSON.stringify(c)).join('\n') + '\n';
  return { jsonl, droppedCount };
}

/**
 * Cube rule reads from `__RULEREAD__` markers: `{cube, length}` with
 * length = LONG of the text the process saw. Deduped per cube, last wins.
 */
export function extractRuleReads(text: string): { cube: string; length: number }[] {
  const fileDelim = detectDelim(text);
  const byCube = new Map<string, number>();
  for (const raw of splitLogRecords(text)) {
    if (raw.trim() === '') continue;
    const fields = parseCsvLine(raw, pickLineDelim(raw, fileDelim));
    if (fields[0] !== '__RULEREAD__' || fields.length !== 3) continue;
    const length = parseNumber(fields[2]);
    if (length !== null) byCube.set(fields[1], length);
  }
  return [...byCube].map(([cube, length]) => ({ cube, length }));
}

/**
 * Whether the REST rule text is the text whose LONG the process logged.
 * Unmeasured how REST and CubeRuleGet differ in line endings and in counting
 * characters outside the BMP, so every plausible reading is accepted: as is,
 * CRLF and LF line endings, code points instead of UTF-16 units.
 */
export function ruleLengthMatches(text: string, length: number): boolean {
  const lf = text.replace(/\r\n/g, '\n');
  const variants = [text, lf, lf.replace(/\n/g, '\r\n')];
  return variants.some((t) => t.length === length || [...t].length === length);
}
