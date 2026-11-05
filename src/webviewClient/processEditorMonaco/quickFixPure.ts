/**
 * Quick fixes for TI linter diagnostics — pure: diagnostic + section lines in,
 * text edits out. No Monaco import; `quickFix.ts` turns them into code actions.
 *
 * Diagnostics carry a line but no column, so every fix re-finds its spot in
 * the line and returns null when that is not unambiguous. A fix that is not
 * offered is better than one that edits the wrong place.
 */

import { maskStringsAndComments } from '../../tiLogicVisualizer/tiLinter/helpers/parse';
import { escapeRegex } from '../../utils/escapeRegexPure';

/**
 * 1-based lines and columns; `endCol` exclusive (Monaco range semantics).
 * `endLine` defaults to `line`; `section` defaults to the diagnostic's section.
 */
export interface LineEdit { line: number; startCol: number; endLine?: number; endCol: number; text: string; section?: TiSectionKey }

export type TiSectionKey = 'prolog' | 'metadata' | 'data' | 'epilog';

export type QuickFixKind = 'addSemicolon' | 'useAtOperator' | 'dropAtOperator' | 'fixCasing' | 'removeAssignment' | 'restoreCubeLog' | 'disableRule';

export interface QuickFix {
  kind: QuickFixKind;
  /** Placeholder arguments for the localized title. */
  args: string[];
  edits: LineEdit[];
  /** A guess about intent rather than a mechanical repair: never the preferred action. */
  notPreferred?: boolean;
}

export interface FixableDiagnostic {
  ruleId: string;
  line: number;
  messageArgs?: (string | number)[];
}

/** The whole process, for fixes that reach into another section. */
export interface ProcessText { section: TiSectionKey; sections: Record<TiSectionKey, string[]> }

/** Every fix for one diagnostic: the repair (if any), then "disable the rule here". */
export function quickFixesFor(d: FixableDiagnostic, p: ProcessText): QuickFix[] {
  const lines = p.sections[p.section];
  const out: QuickFix[] = [];
  const repair = d.ruleId === 'cube-logging-not-restored' ? restoreCubeLog(d, p) : quickFixFor(d, lines);
  if (repair) { out.push(repair); }
  const disable = disableRule(d, lines);
  if (disable) { out.push(disable); }
  return out;
}

export function quickFixFor(d: FixableDiagnostic, lines: string[]): QuickFix | null {
  const text = lines[d.line - 1];
  if (text === undefined) { return null; }
  const args = (d.messageArgs ?? []).map(String);
  switch (d.ruleId) {
    case 'missing-semicolon': return addSemicolon(d.line, lines);
    case 'string-compare-without-at': return swapOperator(d.line, text, args[0], `@${args[0]}`, 'useAtOperator');
    case 'numeric-compare-with-at': return swapOperator(d.line, text, args[0], args[1], 'dropAtOperator');
    case 'inconsistent-var-casing': return fixCasing(d.line, text, args[0], args[1]);
    case 'unused-variable': return removeAssignment(d.line, lines, args[0]);
    default: return null;
  }
}

/**
 * The parser reports the line where the statement STARTS. A call spread over
 * several lines ends later: follow the lines until the brackets balance, then
 * put `;` after the last code character (before a trailing comment).
 */
function addSemicolon(startLine: number, lines: string[]): QuickFix | null {
  let depth = 0;
  for (let i = startLine - 1; i < lines.length; i++) {
    const masked = maskStringsAndComments(lines[i]);
    for (const c of masked) {
      if (c === '(') { depth++; } else if (c === ')') { depth--; }
    }
    if (depth <= 0) {
      const end = codeEnd(lines[i]);
      if (end === 0 || lines[i][end - 1] === ';') { return null; }
      return { kind: 'addSemicolon', args: [], edits: [{ line: i + 1, startCol: end + 1, endCol: end + 1, text: ';' }] };
    }
  }
  return null;
}

/**
 * Length of the line without a trailing comment and whitespace. Unlike the
 * masked text, a string literal counts as code: `x = 'a';` ends after the quote.
 */
function codeEnd(line: string): number {
  let inStr = false;
  let end = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!inStr && c === '#') { break; }
    if (c === "'") { inStr = !inStr; }
    if (inStr || !/\s/.test(c)) { end = i + 1; }
  }
  return end;
}

// Comparison operators, longest first so `<=` is not read as `<` + `=`.
const OP_RE = /@>=|@<=|@<>|@>|@<|@=|>=|<=|<>|>|<|=/g;

/**
 * Replace the one occurrence of `from` in the line. The assignment `=` of
 * `x = …` is not a comparison and does not count; two candidate operators
 * mean the diagnostic cannot say which one — no fix.
 */
function swapOperator(line: number, text: string, from: string | undefined, to: string | undefined, kind: QuickFixKind): QuickFix | null {
  if (!from || !to) { return null; }
  const masked = maskStringsAndComments(text);
  const assign = /^\s*[A-Za-z_][\w.$]*\s*=(?!=)/.exec(masked);
  const assignIdx = assign ? assign[0].length - 1 : -1;
  const hits: number[] = [];
  for (const m of masked.matchAll(OP_RE)) {
    if (m[0] === from && m.index !== assignIdx) { hits.push(m.index); }
  }
  if (hits.length !== 1) { return null; }
  return { kind, args: [from, to], edits: [{ line, startCol: hits[0] + 1, endCol: hits[0] + 1 + from.length, text: to }] };
}

function identifierHits(text: string, name: string): number[] {
  const masked = maskStringsAndComments(text);
  const escaped = escapeRegex(name);
  const re = new RegExp(`(?<![\\w.$])${escaped}(?![\\w.$])`, 'gi');
  return [...masked.matchAll(re)].map(m => m.index);
}

/** Every occurrence spelled like `name` (exactly) on this line becomes `canonical`. */
function fixCasing(line: number, text: string, name: string | undefined, canonical: string | undefined): QuickFix | null {
  if (!name || !canonical || name === canonical) { return null; }
  const edits = identifierHits(text, name)
    .filter(i => text.slice(i, i + name.length) === name)
    .map(i => ({ line, startCol: i + 1, endCol: i + 1 + name.length, text: canonical }));
  return edits.length ? { kind: 'fixCasing', args: [name, canonical], edits } : null;
}

// ponytail: name-based list of TI calls that act beyond their return value.
// Anything else on the right side is treated as free of side effects; extend
// the list when a new such function turns up.
const SIDE_EFFECT_CALL = /(?<![\w.$])(Execute\w*|RunProcess|CellPut\w*|CellIncrement\w*|ASCIIOutput|TextOutput|LogOutput|Dimension\w+|Hierarchy\w+|Subset\w+|View\w+|Cube\w+|Element\w+|Chore\w+|Attr(?:Insert|Delete|Put\w*)|Server\w+|Save\w*|Security\w+|Assign\w+|AddClient|DeleteClient|AddGroup|DeleteGroup|Remove\w+|Set\w+|ProcessQuit|ProcessBreak|ProcessError)\s*\(/i;

/**
 * Remove `name = …;` when it is one complete statement on one line and the
 * right side calls nothing that acts on its own — `n = ExecuteProcess(…);`
 * would lose the process run, not just the variable.
 */
function removeAssignment(line: number, lines: string[], name: string | undefined): QuickFix | null {
  if (!name) { return null; }
  const masked = maskStringsAndComments(lines[line - 1]);
  const m = /^\s*([A-Za-z_][\w.$]*)\s*=(?!=)(.*);\s*$/.exec(masked);
  if (!m || m[1].toLowerCase() !== name.toLowerCase()) { return null; }
  if (m[2].includes(';') || SIDE_EFFECT_CALL.test(m[2])) { return null; }
  // The whole line goes, a trailing comment with it, and its line break: up to
  // the start of the next line, or — on the last line — from the end of the
  // previous one.
  const edit: LineEdit = line < lines.length
    ? { line, startCol: 1, endLine: line + 1, endCol: 1, text: '' }
    : line > 1
      ? { line: line - 1, startCol: lines[line - 2].length + 1, endLine: line, endCol: lines[line - 1].length + 1, text: '' }
      : { line, startCol: 1, endCol: lines[0].length + 1, text: '' };
  return { kind: 'removeAssignment', args: [name], edits: [edit] };
}

/**
 * `CubeSetLogChanges(c, 0)` without a restore: remember the setting before
 * switching off, put it back at the end of the epilog. Restoring the previous
 * value, not a hard `1` — logging may have been off already.
 *
 * Only for the prolog and the epilog: metadata and data run once per record,
 * so from the second record on the "before" value would read the 0 just set.
 * A ProcessQuit or an error before the epilog still skips the restore — as it
 * does for a hand-written one.
 */
function restoreCubeLog(d: FixableDiagnostic, p: ProcessText): QuickFix | null {
  if (p.section !== 'prolog' && p.section !== 'epilog') { return null; }
  const cube = d.messageArgs?.[0] !== undefined ? String(d.messageArgs[0]) : '';
  const lines = p.sections[p.section];
  const text = lines[d.line - 1];
  if (!cube || text === undefined || !/CubeSetLogChanges\s*\(/i.test(maskStringsAndComments(text))) { return null; }
  const variable = freeName('nCubeLogBefore', p.sections);
  const indent = /^\s*/.exec(text)?.[0] ?? '';
  const epilog = p.sections.epilog;
  // After the last line of the epilog; its own line break when it is not empty.
  const last = epilog.length;
  const lastLen = epilog[last - 1]?.length ?? 0;
  const restore = `CubeSetLogChanges(${cube}, ${variable});`;
  return {
    kind: 'restoreCubeLog',
    args: [cube],
    edits: [
      { line: d.line, startCol: 1, endCol: 1, text: `${indent}${variable} = CubeGetLogChanges(${cube});\n` },
      { section: 'epilog', line: Math.max(last, 1), startCol: lastLen + 1, endCol: lastLen + 1,
        text: last === 0 || (last === 1 && lastLen === 0) ? restore : `\n${restore}` },
    ],
  };
}

/** `base`, or `base2`, `base3`, … — the first name no section uses yet. */
function freeName(base: string, sections: Record<TiSectionKey, string[]>): string {
  const all = Object.values(sections).map(l => l.join('\n')).join('\n');
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}${n}`;
    if (!new RegExp(`(?<![\\w.$])${name}(?![\\w.$])`, 'i').test(all)) { return name; }
  }
}

// Parser findings and TM1's own compile errors are not rules one can waive:
// hiding them hides a process that does not run.
const NOT_DISABLEABLE = new Set(['parse-error', 'missing-semicolon', 'tm1-compile', 'tm1-error-code']);
const DIRECTIVE_NEXT = /^(\s*)#\s*tm1lint\s*:\s*disable-next-line\s*(?:=\s*([^#]*))?$/i;

/**
 * `# tm1lint: disable-next-line=<rule>` above the line. An existing directive
 * there gets the rule appended instead of a second directive line.
 */
function disableRule(d: FixableDiagnostic, lines: string[]): QuickFix | null {
  if (NOT_DISABLEABLE.has(d.ruleId) || lines[d.line - 1] === undefined) { return null; }
  const base = { kind: 'disableRule' as const, args: [d.ruleId], notPreferred: true };
  const above = d.line > 1 ? lines[d.line - 2] : undefined;
  const m = above !== undefined ? DIRECTIVE_NEXT.exec(above) : null;
  if (m) {
    // No list = already silences everything; nothing to add.
    if (!m[2] || !m[2].trim()) { return null; }
    const ids = m[2].split(',').map(s => s.trim().toLowerCase());
    if (ids.includes(d.ruleId)) { return null; }
    const end = above!.trimEnd().length;
    return { ...base, edits: [{ line: d.line - 1, startCol: end + 1, endCol: end + 1, text: `,${d.ruleId}` }] };
  }
  const indent = /^\s*/.exec(lines[d.line - 1])?.[0] ?? '';
  return { ...base, edits: [{ line: d.line, startCol: 1, endCol: 1, text: `${indent}# tm1lint: disable-next-line=${d.ruleId}\n` }] };
}
