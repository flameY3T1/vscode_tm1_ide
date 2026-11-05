/**
 * Pure helpers for the TiDiagnosticsProvider.
 *
 * Extracted from `tiDiagnosticsProvider.ts` (Post-H17 #12 coverage push).
 * No vscode-API access — inputs are plain strings, outputs are plain shapes.
 * Allows unit tests without the VS Code runtime.
 */

import type { TiSection } from '../tiLogicVisualizer/lintTypes';
import { findVersionIncompatibleCalls } from '../tiLogicVisualizer/tiLinter/versionCompatPure';
import { splitSections } from '../git/sectionMarkers';
import type { TiParam } from '../utils/proFile';
export { findVersionIncompatibleCalls } from '../tiLogicVisualizer/tiLinter/versionCompatPure';

export const SECTION_MARKER_RE = /^(572|573|574|575),\d*$/;
export const SECTION_CODE_MAP: Record<string, TiSection> = {
  '572': 'prolog', '573': 'metadata', '574': 'data', '575': 'epilog',
};

export interface SectionChunk {
  section: TiSection;
  code: string;
  /** 0-indexed line number in the full file where this section's code starts. */
  lineOffset: number;
}

/**
 * Splits a .pro file into its 4 TM1 sections with their absolute line offsets.
 * Returns null if no section markers are found (e.g. plain .ti files).
 */
export function parseSectionsWithOffsets(text: string): SectionChunk[] | null {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const headers: { code: string; idx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_MARKER_RE);
    if (m) { headers.push({ code: m[1], idx: i }); }
  }
  if (headers.length === 0) { return null; }

  const result: SectionChunk[] = [];
  for (let h = 0; h < headers.length; h++) {
    const { code, idx } = headers[h];
    const codeStart = idx + 1;
    const nextHeaderIdx = h + 1 < headers.length ? headers[h + 1].idx : lines.length;

    const codeLines: string[] = [];
    for (let j = codeStart; j < nextHeaderIdx; j++) {
      // Stop at .pro trailer/footer lines (e.g. 576,…)
      if (/^\d{3},/.test(lines[j]) && !SECTION_MARKER_RE.test(lines[j])) { break; }
      codeLines.push(lines[j]);
    }

    result.push({
      section: SECTION_CODE_MAP[code],
      code: codeLines.join('\n'),
      lineOffset: codeStart,
    });
  }
  return result;
}

/**
 * Splits a git-export `.ti` (TM1's native `#region Prolog` … `#endregion`
 * blob) into its sections with absolute line offsets. Null when the markers
 * are damaged (see `splitSections`), or when the text is no such file.
 */
export function tiFileSectionsWithOffsets(text: string): SectionChunk[] | null {
  const sections = splitSections(text);
  if (!sections) { return null; }
  const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim().toLowerCase());
  const result: SectionChunk[] = [];
  let from = 0;
  for (const section of ['prolog', 'metadata', 'data', 'epilog'] as const) {
    const code = sections[section];
    if (code === '') { continue; }
    const open = lines.indexOf(`#region ${section}`, from);
    if (open < 0) { return null; }
    result.push({ section, code, lineOffset: open + 1 });
    from = open + 1 + code.split('\n').length;
  }
  return result;
}

/**
 * Parameters and data source variable names from the `.json` header next to
 * a `.ti`. `undefined` when the header is missing or broken — then nobody
 * knows which names are defined.
 */
export function tiHeaderNames(jsonText: string | undefined): { params: TiParam[]; dsVarNames: string[] } | undefined {
  if (jsonText === undefined) { return undefined; }
  try {
    const h = JSON.parse(jsonText) as {
      Parameters?: Array<{ Name: string; Type?: string; Value?: unknown; Prompt?: string }>;
      Variables?: Array<{ Name: string }>;
    };
    return {
      params: (h.Parameters ?? []).map(p => ({
        Name: p.Name, Type: p.Type === 'Numeric' ? 1 : 2, Value: String(p.Value ?? ''), Prompt: p.Prompt ?? '',
      })),
      // Ignored columns are not in `Variables` at all (they live in VariablesUIData).
      dsVarNames: (h.Variables ?? []).map(v => v.Name),
    };
  } catch {
    return undefined;
  }
}

export interface V12Range {
  line: number;
  startCol: number;
  endCol: number;
  originalName: string;
}

/**
 * Find all V12-deprecated function-call positions in the text.
 * Returns plain shapes (line/col) — caller wraps in vscode.Range.
 *
 * The strikethrough in the editor shows only this one direction: a
 * function that no longer exists from v12 onward is struck-through text.
 * The reverse case (a v12 function on 11.x) is not a strikethrough but a
 * warning — it reaches the diagnostics via `findVersionIncompatibleCalls`,
 * not through here.
 */
export function computeV12DeprecatedRanges(text: string): V12Range[] {
  return findVersionIncompatibleCalls(text, 'v12').map(h => ({
    line: h.line,
    startCol: h.startCol,
    endCol: h.endCol,
    originalName: h.name,
  }));
}
