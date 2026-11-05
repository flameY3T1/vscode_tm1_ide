/**
 * Outline entries for plain TI (`.ti`/`.pro`) and rules (`.rux`) files — the data
 * behind the DocumentSymbolProvider (Outline view + breadcrumbs).
 *
 * Reuses the fold-range detectors instead of parsing a second time: every
 * foldable `region` becomes one entry, named after the line that opens it
 * (`#Region prolog` → `prolog`, `SKIPCHECK;` → `SKIPCHECK`). Comment runs and
 * IF/WHILE blocks are deliberately left out — an outline of every IF in a
 * 5000-line process is noise, not navigation.
 *
 * Pure — no vscode, no server. A file on disk carries no server binding, and
 * nothing here needs one.
 */
import { detectRegionRanges } from './regionRanges';
import { detectRulesFoldRanges } from './rulesFoldRanges';

export interface OutlineNode {
  /** Display name, taken from the opening line. */
  name: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  children: OutlineNode[];
}

/** Name for an entry: the opening line without the `#Region` marker and without
 *  a trailing `;`. Falls back to 'region' when that leaves nothing. */
function nameFor(line: string): string {
  const stripped = line.trim().replace(/^#region\b/i, '').replace(/;\s*$/, '').trim();
  return stripped === '' ? 'region' : stripped;
}

/** Nests ranges by containment (outer first) and names each from its opening
 *  line. Sorted by start line, longer range first, so an outer region is always
 *  on the stack before the regions it contains. */
function nest(code: string, ranges: Array<{ startLine: number; endLine: number }>): OutlineNode[] {
  const lines = code.split('\n');
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const r of sorted) {
    const node: OutlineNode = {
      name: nameFor(lines[r.startLine - 1] ?? ''),
      startLine: r.startLine,
      endLine: r.endLine,
      children: [],
    };
    // Drop every open parent that ends before this range starts.
    while (stack.length > 0 && stack[stack.length - 1].endLine < node.startLine) { stack.pop(); }
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  }

  return roots;
}

/** Outline for a plain TI file: the `#Region` sections (prolog/metadata/data/epilog
 *  in a mirrored process, plus any hand-written ones). */
export function tiOutline(code: string): OutlineNode[] {
  return nest(code, detectRegionRanges(code));
}

/** Outline for a plain rules file: the SKIPCHECK and FEEDERS sections plus
 *  `#Region` blocks. */
export function rulesOutline(code: string): OutlineNode[] {
  return nest(code, detectRulesFoldRanges(code).filter(r => r.kind === 'region'));
}
