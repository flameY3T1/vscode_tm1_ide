/**
 * Pure Element-Qualifier.
 *
 * Rewrites bare cell-references (`['Elem']`, `['ElemA', 'ElemB']`,
 * `['{...}']`) in TM1 rules to qualified form (`['Dim':'Elem']`).
 *
 * Reorders entries in each `[...]` block to match the cube's dimension order.
 * Already-qualified entries, vars and unknown tokens are preserved.
 *
 * No vscode dependency — async data fetching lives in `cubeElementIndex.ts`.
 */

import { findBracketBlocks, parseBracketContent, type CellRefEntry } from './cellRefParser';
import { normalizeElementName } from '../utils/tm1ElementName';

export interface CubeIndex {
  /** Cube name (used for warnings only). */
  cube: string;
  /** Dimensions in cube-defined order (for reordering). */
  dimOrder: string[];
  /**
   * Reverse-index: lowercased element name → list of dim names that contain it.
   * One entry per dim that contains the element, in cube dim order.
   */
  elemToDims: Map<string, string[]>;
}

export interface QualifyWarning {
  /** 1-based line number in source text. */
  line: number;
  /** Original entry text (e.g. `'Bestellerentgelt'`). */
  entry: string;
  /** Why this entry could not be qualified. */
  reason: 'not-found' | 'ambiguous' | 'set-mixed-dims' | 'set-member-not-found';
  /** Dim candidates when ambiguous; or full message detail. */
  detail?: string;
}

export interface QualifyResult {
  text: string;
  warnings: QualifyWarning[];
}

/**
 * Resolves a single bare element name to its dimension.
 * Returns `null` if not found, `'ambiguous'` if in multiple dims.
 */
function resolveDim(idx: CubeIndex, elem: string): string | null | 'ambiguous' {
  const hits = idx.elemToDims.get(normalizeElementName(elem));
  if (!hits || hits.length === 0) { return null; }
  if (hits.length > 1) { return 'ambiguous'; }
  return hits[0];
}

/** Returns the cube-dim-position for a given dim name (case-insensitive), or `Infinity` if not found. */
function dimPosition(idx: CubeIndex, dim: string | null): number {
  if (!dim) { return Number.POSITIVE_INFINITY; }
  const lower = dim.toLowerCase();
  const i = idx.dimOrder.findIndex(d => d.toLowerCase() === lower);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/**
 * Resolves an entry to its dimension and the element(s) it contributes.
 * Returns `null` for entries that cannot be qualified (vars, unknown tokens
 * incl. function calls like `DB()`, not-found / ambiguous bares, mixed or
 * incomplete sets) — those are preserved verbatim. Warnings are pushed onto
 * `warnings`.
 */
function resolveEntry(
  entry: CellRefEntry,
  blockLine: number,
  idx: CubeIndex,
  warnings: QualifyWarning[],
): { dim: string; elems: string[] } | null {
  switch (entry.kind) {
    case 'qualified':
      return { dim: entry.dim, elems: [entry.elem] };
    case 'qualifiedSet':
      return { dim: entry.dim, elems: entry.elems };
    case 'bare': {
      const r = resolveDim(idx, entry.elem);
      if (r === 'ambiguous') {
        const dims = idx.elemToDims.get(normalizeElementName(entry.elem)) ?? [];
        warnings.push({ line: blockLine, entry: entry.raw, reason: 'ambiguous', detail: dims.join(', ') });
        return null;
      }
      if (r === null) {
        warnings.push({ line: blockLine, entry: entry.raw, reason: 'not-found' });
        return null;
      }
      return { dim: r, elems: [entry.elem] };
    }
    case 'bareSet': {
      const memberDims: (string | null)[] = entry.elems.map(e => {
        const r = resolveDim(idx, e);
        return (r === 'ambiguous' || r === null) ? null : r;
      });
      const missing = entry.elems.filter((_, i) => memberDims[i] === null);
      if (missing.length > 0) {
        warnings.push({
          line: blockLine,
          entry: entry.raw,
          reason: 'set-member-not-found',
          detail: missing.map(e => `'${e}'`).join(', '),
        });
        return null;
      }
      const uniq = new Set(memberDims as string[]);
      if (uniq.size > 1) {
        warnings.push({
          line: blockLine,
          entry: entry.raw,
          reason: 'set-mixed-dims',
          detail: [...uniq].join(', '),
        });
        return null;
      }
      return { dim: memberDims[0] as string, elems: entry.elems };
    }
    case 'var':
    case 'unknown':
      return null;
  }
}

interface RenderUnit {
  rendered: string;
  sortKey: number;
  origIdx: number;
}

interface DimGroup {
  dimName: string;
  elems: string[];
  minOrigIdx: number;
}

function processBracketBlock(
  content: string,
  blockLine: number,
  idx: CubeIndex,
): { rendered: string; warnings: QualifyWarning[] } {
  const entries = parseBracketContent(content);
  const warnings: QualifyWarning[] = [];
  const groups = new Map<string, DimGroup>();
  const units: RenderUnit[] = [];

  entries.forEach((entry, origIdx) => {
    const resolved = resolveEntry(entry, blockLine, idx, warnings);
    if (!resolved) {
      // Preserve verbatim (vars, function calls, unresolved bares/sets).
      units.push({ rendered: entry.raw, sortKey: Number.POSITIVE_INFINITY, origIdx });
      return;
    }
    // A dimension may appear only once inside a `[...]` block, so multiple
    // elements of the same dim are merged into a single qualified set.
    const key = resolved.dim.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.elems.push(...resolved.elems);
    } else {
      groups.set(key, { dimName: resolved.dim, elems: [...resolved.elems], minOrigIdx: origIdx });
    }
  });

  for (const g of groups.values()) {
    const rendered = g.elems.length === 1
      ? `'${g.dimName}':'${g.elems[0]}'`
      : `'${g.dimName}':{${g.elems.map(e => `'${e}'`).join(', ')}}`;
    units.push({ rendered, sortKey: dimPosition(idx, g.dimName), origIdx: g.minOrigIdx });
  }

  // Stable sort: by cube-dim-position, then by original order (entries without
  // a known dim sort to the end in their original relative order).
  units.sort((a, b) => {
    if (a.sortKey !== b.sortKey) { return a.sortKey - b.sortKey; }
    return a.origIdx - b.origIdx;
  });

  return { rendered: units.map(u => u.rendered).join(', '), warnings };
}

/** 1-based line number of the given offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') { line++; }
  }
  return line;
}

/**
 * Qualifies bare element references in `text` against `idx`. Bare entries
 * inside `[...]` are rewritten as `'Dim':'Elem'`; entries are reordered to
 * match the cube's dim order. Already-qualified entries, vars, and unknown
 * tokens are preserved as-is. DB() arguments are not touched (they are not
 * `[...]` blocks).
 */
export function qualifyElements(text: string, idx: CubeIndex): QualifyResult {
  const blocks = findBracketBlocks(text);
  if (blocks.length === 0) { return { text, warnings: [] }; }

  const allWarnings: QualifyWarning[] = [];
  const replacements: { start: number; end: number; replacement: string }[] = [];

  for (const block of blocks) {
    const blockLine = lineAt(text, block.start);
    const { rendered, warnings } = processBracketBlock(block.content, blockLine, idx);
    allWarnings.push(...warnings);
    const original = text.slice(block.start, block.end + 1);
    const newText = `[${rendered}]`;
    if (newText !== original) {
      replacements.push({ start: block.start, end: block.end + 1, replacement: newText });
    }
  }

  if (replacements.length === 0) { return { text, warnings: allWarnings }; }

  let out = text;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  return { text: out, warnings: allWarnings };
}
