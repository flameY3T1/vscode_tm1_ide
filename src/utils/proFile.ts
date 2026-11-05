/**
 * Shared .pro file parsing utilities — no vscode or side-effect imports.
 * Safe to import from providers, completions, and diagnostics.
 */

import { mergeVariableColumns } from './processVariablesUi';

export interface TiSections {
  prolog:   string;
  metadata: string;
  data:     string;
  epilog:   string;
}

/** Subset of the TM1 REST ProcessVariable shape produced by .pro parsing. */
export interface ProFileVariable {
  Name: string;
  Type: 'Numeric' | 'String';
  Position: number;
  StartByte: number;
  EndByte: number;
  /** Contents = "Ignore" — column is skipped and invisible to the TI code. */
  Ignored?: boolean;
}

/**
 * Parses .pro variable blocks (577=names, 578=types, 579=positions, 580=startBytes,
 * 581=endBytes, 582=UI data — all positioned BEFORE the 572 Prolog header) into
 * REST-shaped variables.
 *
 * Block 582 mirrors `VariablesUIData` and has one line per SOURCE column, so it is
 * LONGER than 577–581 whenever a column carries Contents="Ignore" — the name of an
 * ignored column exists in block 582 alone. Ignored columns come back with
 * `Ignored: true`; callers that feed the linter must filter them out, since TI code
 * cannot read them.
 */
export function toRestVariables(content: string): ProFileVariable[] {
  const lines = splitLines(content);
  const prologIdx = lines.findIndex(l => /^572,/.test(l));
  const preProlog = prologIdx === -1 ? lines : lines.slice(0, prologIdx);

  let names: string[] = [];
  let types: number[] = [];
  let positions: number[] = [];
  let startBytes: number[] = [];
  let endBytes: number[] = [];
  let uiData: string[] = [];

  let i = 0;
  while (i < preProlog.length) {
    const m = preProlog[i].match(/^(577|578|579|580|581|582),(\d+)$/);
    if (m) {
      const code = m[1];
      const count = parseInt(m[2], 10);
      const data = preProlog.slice(i + 1, i + 1 + count);
      if (code === '577') { names = data.map(l => l.trim()); }
      else if (code === '578') { types = data.map(l => parseInt(l.trim(), 10) || 2); }
      else if (code === '579') { positions = data.map(l => parseInt(l.trim(), 10) || 1); }
      else if (code === '580') { startBytes = data.map(l => parseInt(l.trim(), 10) || 0); }
      else if (code === '581') { endBytes = data.map(l => parseInt(l.trim(), 10) || 0); }
      else if (code === '582') { uiData = data; }
      i += 1 + count;
      continue;
    }
    i++;
  }

  const used = names.map((name, idx) => ({
    Name: name,
    Type: (types[idx] ?? 2) === 1 ? 'Numeric' as const : 'String' as const,
    Position: positions[idx] ?? (idx + 1),
    StartByte: startBytes[idx] ?? 0,
    EndByte: endBytes[idx] ?? 0,
  }));

  return mergeVariableColumns(used, uiData).map(c => ({
    Name: c.Name,
    Type: c.Type,
    Position: c.Position,
    StartByte: c.StartByte,
    EndByte: c.EndByte,
    ...(c.Ignored ? { Ignored: true } : {}),
  }));
}

/**
 * Reads block 576 — Architect's remembered wizard state, mirroring the REST
 * `UIData` property (`CubeAction=…\fDataAction=…\fCubeLogChanges=…\f`).
 *
 * Unlike the variable blocks this one carries its value on the SAME line as the
 * code and sits in the FOOTER, after the code sections. A section's own text
 * could therefore contain a line that looks like the header, so the LAST match
 * wins — the footer is at the end of the file.
 *
 * An empty `576,` is a value, not an absence: TM1 12 keeps `UIData: ""`, and a
 * POST that omits the key leaves it missing (91 of 92 Bedrock v5 processes,
 * measured 2026-10-14). Undefined only when the file has no such line.
 */
export function toProUiData(content: string): string | undefined {
  const lines = splitLines(content);
  const footer = footerStart(lines);
  return footer === -1 ? undefined : lines[footer].slice('576,'.length);
}

function splitLines(content: string): string[] {
  return content.split('\n').map(l => l.replace(/\r$/, ''));
}

/**
 * Index of the footer's first line, the LAST `576,` line of the file — a
 * code section may hold a line that looks like it. -1 without one.
 */
function footerStart(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('576,')) { return i; }
  }
  return -1;
}

/**
 * Footer line `1217` carries `HasSecurityAccess` (`1217,1` = on). Measured
 * 2026-10-14 against 366 processes on 11.8: 86 of 86 with the flag on say
 * `1217,1`, 280 of 280 with it off say `1217,0`; no other line tracks it.
 * Undefined when the file has no such line, so a deploy leaves the flag alone.
 */
export function toProHasSecurity(content: string): boolean | undefined {
  const lines = splitLines(content);
  const footer = footerStart(lines);
  if (footer === -1) { return undefined; }
  for (let i = footer + 1; i < lines.length; i++) {
    const m = /^1217,(\d)$/.exec(lines[i]);
    if (m) { return m[1] === '1'; }
  }
  return undefined;
}

/** Strips the outer quotes of a .pro value; TM1 doubles inner ones (`""` = `"`). */
function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}

/** REST-shaped TM1 process parameter (subset of PA REST ProcessParameter). */
export interface ProFileParameter {
  Name: string;
  Type: 'Numeric' | 'String';
  /** Default value — Numeric params use number, String params use string. */
  Value: string | number;
  Prompt: string;
}

/** Minimal REST-shaped datasource descriptor produced from .pro parsing. */
export interface ProFileDataSource {
  Type: string;
  [k: string]: unknown;
}

/**
 * Parses TM1 .pro parameter blocks into REST-shaped parameters.
 *
 * Codes (all in the pre-prolog section, before code 572):
 *   560,N  + N lines — parameter names (one per line)
 *   561,N  + N lines — parameter types (1=Numeric, 2=String, one per line)
 *   590,N  + N lines — parameter defaults, format: `name,value`
 *   637,N  + N lines — parameter prompts, format: `name,"prompt text"`
 */
export function toRestParameters(content: string): ProFileParameter[] {
  const lines = splitLines(content);
  const prologIdx = lines.findIndex(l => /^572,/.test(l));
  const preProlog = prologIdx === -1 ? lines : lines.slice(0, prologIdx);

  let names: string[] = [];
  let types: number[] = [];
  const defaultsByName = new Map<string, string>();
  const promptsByName = new Map<string, string>();

  let i = 0;
  while (i < preProlog.length) {
    const m = preProlog[i].match(/^(560|561|590|637),(\d+)$/);
    if (m) {
      const code = m[1];
      const count = parseInt(m[2], 10);
      const data = preProlog.slice(i + 1, i + 1 + count);

      if (code === '560') {
        names = data.map(l => l.trim());
      } else if (code === '561') {
        types = data.map(l => parseInt(l.trim(), 10) || 2);
      } else if (code === '590') {
        // Format: `pName,value` or `pName,"value"` or `pName,`
        for (const line of data) {
          const comma = line.indexOf(',');
          if (comma === -1) { continue; }
          defaultsByName.set(line.slice(0, comma).trim(), line.slice(comma + 1).trim());
        }
      } else if (code === '637') {
        // Format: `pName,"prompt text"` or `pName,`
        for (const line of data) {
          const comma = line.indexOf(',');
          if (comma === -1) { continue; }
          const raw = line.slice(comma + 1).trim();
          promptsByName.set(line.slice(0, comma).trim(), unquote(raw));
        }
      }

      i += 1 + count;
      continue;
    }
    i++;
  }

  return names.map((name, idx) => {
    const isNumeric = (types[idx] ?? 2) === 1;
    const rawDefault = defaultsByName.get(name) ?? '';
    let value: string | number;
    if (isNumeric) {
      const stripped = unquote(rawDefault);
      value = stripped === '' ? 0 : (parseFloat(stripped) || 0);
    } else {
      value = unquote(rawDefault);
    }
    return {
      Name: name,
      Type: isNumeric ? 'Numeric' as const : 'String' as const,
      Value: value,
      Prompt: promptsByName.get(name) ?? '',
    };
  });
}

const _DS_TYPE_MAP: Record<string, string> = {
  'null':               'None',
  'view':               'TM1CubeView',
  'subset':             'TM1DimensionSubset',
  'characterdelimited': 'ASCII',
  'odbc':               'ODBC',
};

/**
 * Parses the datasource type from a TM1 .pro file (code 562) and returns a
 * minimal REST-shaped datasource descriptor.
 *
 * Code 562,"TYPE" — appears in the pre-prolog header. Known tokens:
 *   NULL → { Type: 'None' }
 *   VIEW → { Type: 'TM1CubeView' }
 *   SUBSET → { Type: 'TM1DimensionSubset' }
 *   CHARACTERDELIMITED → { Type: 'ASCII' }
 *   ODBC → { Type: 'ODBC' }
 */
export function toRestDataSource(content: string): ProFileDataSource {
  const lines = splitLines(content);
  const prologIdx = lines.findIndex(l => /^572,/.test(l));
  const preProlog = prologIdx === -1 ? lines : lines.slice(0, prologIdx);

  for (const line of preProlog) {
    const m = line.match(/^562,"?([^",\r\n]+)"?/);
    if (m) {
      const token = m[1].trim().toLowerCase();
      return { Type: _DS_TYPE_MAP[token] ?? 'None' };
    }
  }
  return { Type: 'None' };
}

/**
 * Parses native TM1 .pro format into its four code sections.
 * Section codes: 572=Prolog, 573=Metadata, 574=Data, 575=Epilog.
 *
 * A section runs up to the next section header; the last one up to the
 * footer, which starts at the last `576,` line. Inside that range the count
 * in the header decides, so trailing blank lines survive and a code line that
 * looks like a header (`930,0`) stays code. Only when non-blank lines follow
 * beyond the count (a hand-edited file, or the Bedrock repo's
 * `}bedrock.server.util.string.validate.pro`, which says `572,185` over 189
 * lines) does the whole range win, without its trailing blank lines.
 * Trusting the count there drops `END;` and `#EndRegion` (measured
 * 2026-10-14 against the MCP import, which does exactly that).
 */
export function parseSections(content: string): TiSections {
  const sectionMap: Record<string, string> = { '572': '', '573': '', '574': '', '575': '' };
  const lines = splitLines(content);
  const SECTION_RE = /^(572|573|574|575),(\d*)$/;

  const headers: Array<{ code: string; idx: number; count: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_RE);
    if (m) { headers.push({ code: m[1], idx: i, count: m[2] === '' ? NaN : parseInt(m[2], 10) }); }
  }

  const footer = footerStart(lines);
  for (let h = 0; h < headers.length; h++) {
    const { code, idx, count } = headers[h];
    const end = h + 1 < headers.length ? headers[h + 1].idx : footer > idx ? footer : lines.length;
    const range = lines.slice(idx + 1, end);
    const countHolds = count <= range.length && range.slice(count).every(l => l.trim() === '');
    sectionMap[code] = countHolds ? range.slice(0, count).join('\n') : range.join('\n').trimEnd();
  }

  return {
    prolog:   sectionMap['572'],
    metadata: sectionMap['573'],
    data:     sectionMap['574'],
    epilog:   sectionMap['575'],
  };
}

export interface TiParam {
  Name: string;
  Type: number;   // 1 = Numeric, 2 = String (.pro file format)
  Value: string;  // default value
  Prompt: string;
}

/**
 * Parses parameters from .pro file content using metadata blocks before
 * section 572 (Prolog).
 *
 * Blocks recognized:
 * - `560,N` — N parameter names (one per line)
 * - `561,N` — N types (1=numeric, 2=string)
 * - `590,N` — N default values (`name,value` or `name,"value"`)
 * - `637,N` — N descriptions (`name,"description"`)
 *
 * Returns one entry per name, joined with the corresponding type/value/prompt
 * (defaults: type=1, value='', prompt=name).
 */
export function parseParametersFromFileContent(content: string): TiParam[] {
  const lines = splitLines(content);

  const prologIdx = lines.findIndex(l => /^572,/.test(l));
  const preProlog = prologIdx === -1 ? lines : lines.slice(0, prologIdx);

  let names: string[] = [];
  let types: number[] = [];
  const defaults: Record<string, string> = {};
  const prompts: Record<string, string> = {};

  let i = 0;
  while (i < preProlog.length) {
    const line = preProlog[i];
    const blockMatch = line.match(/^(560|561|590|637),(\d+)$/);
    if (blockMatch) {
      const code = blockMatch[1];
      const count = parseInt(blockMatch[2], 10);
      const dataLines = preProlog.slice(i + 1, i + 1 + count);

      if (code === '560') {
        names = dataLines.map(l => l.trim());
      } else if (code === '561') {
        types = dataLines.map(l => parseInt(l.trim(), 10) || 1);
      } else if (code === '590' || code === '637') {
        for (const dl of dataLines) {
          const commaIdx = dl.indexOf(',');
          if (commaIdx === -1) { continue; }
          const name = dl.slice(0, commaIdx);
          const val = unquote(dl.slice(commaIdx + 1));
          if (code === '590') { defaults[name] = val; }
          else { prompts[name] = val; }
        }
      }

      i += 1 + count;
      continue;
    }
    i++;
  }

  return names.map((name, idx) => ({
    Name: name,
    Type: types[idx] ?? 1,
    Value: defaults[name] ?? '',
    Prompt: prompts[name] ?? name,
  }));
}
