/**
 * Pure, vscode-free building blocks for the TI auto-formatter.
 * Every content rule operates only on the "code" part of a line
 * (outside '...' strings and #... comments) — string/comment bytes
 * are never mutated.
 */
import { KNOWN_SIGNATURES } from './tiSignatures';

export type FRuleId =
  | 'keyword-case'
  | 'operator-spacing'
  | 'space-after-comma'
  | 'no-space-before-semicolon'
  | 'collapse-spaces'
  | 'no-trailing-space'
  | 'space-after-comment'
  | 'block-indent'
  | 'one-statement-per-line'
  | 'max-blank-lines'
  | 'wrap-long-calls'
  | 'normalize-identifier-case';

export interface TiFormatConfig {
  enabled: Record<FRuleId, boolean>;
  keywordCase: 'upper' | 'lower' | 'camel';
  parenStyle: 'tight' | 'spaced' | 'off';
  indentUnit: string;
  /** wrap-long-calls — wrap ExecuteProcess/RunProcess calls on lines longer than this. */
  wrapColumn: number;
  /** Runtime-only (not persisted): process-wide lowercase→canonical identifier map,
   *  supplied by the caller for the 'normalize-identifier-case' rule. */
  identifierCanonical?: Map<string, string>;
}

export const DEFAULT_FORMAT_CONFIG: TiFormatConfig = {
  enabled: {
    'keyword-case': true, 'operator-spacing': false, 'space-after-comma': true, 'no-space-before-semicolon': true,
    'collapse-spaces': true, 'no-trailing-space': true, 'space-after-comment': true, 'block-indent': true,
    'one-statement-per-line': true, 'max-blank-lines': true, 'wrap-long-calls': false,
    'normalize-identifier-case': true,
  },
  keywordCase: 'upper',
  parenStyle: 'tight',
  indentUnit: '    ',
  wrapColumn: 120,
};

/** Overlay a (possibly partial) stored config onto defaults, backfilling any
 *  missing rule flags. Stale rule-IDs (earlier schemes) are dropped → default. */
export function mergeFormatConfig(stored: Partial<TiFormatConfig> | undefined): TiFormatConfig {
  if (!stored) { return { ...DEFAULT_FORMAT_CONFIG, enabled: { ...DEFAULT_FORMAT_CONFIG.enabled } }; }
  const enabled = { ...DEFAULT_FORMAT_CONFIG.enabled };
  for (const id of Object.keys(enabled) as FRuleId[]) {
    if (stored.enabled && id in stored.enabled) { enabled[id] = stored.enabled[id]!; }
  }
  return { ...DEFAULT_FORMAT_CONFIG, ...stored, enabled };
}

/** Index of the first unquoted, non-bracketed '#' comment marker, or -1. */
export function commentStart(line: string): number {
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === "'") { inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '[') { depth++; continue; }
    if (c === ']') { if (depth > 0) { depth--; } continue; }
    if (c === '#' && depth === 0) { return i; }
  }
  return -1;
}

/** Per-char mask: true = active code (outside strings, comments, and [...] refs). */
export function codeMask(s: string): boolean[] {
  const m = new Array<boolean>(s.length).fill(false);
  const cmt = commentStart(s);
  const end = cmt >= 0 ? cmt : s.length;
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < end; i++) {
    const c = s[i];
    if (inStr) { if (c === "'") { inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '[') { depth++; continue; }
    if (c === ']') { if (depth > 0) { depth--; } continue; }
    if (depth > 0) { continue; }
    m[i] = true;
  }
  return m;
}

/** collapse multiple spaces to one in code, preserving leading indent and string interiors. */
export function collapseSpaces(code: string): string {
  const indentLen = code.length - code.replace(/^[ \t]+/, '').length;
  const mask = codeMask(code);
  let out = code.slice(0, indentLen);
  let prevSpace = false;
  for (let i = indentLen; i < code.length; i++) {
    const c = code[i];
    if (c === ' ' && mask[i]) {
      if (prevSpace) { continue; }
      prevSpace = true;
      out += ' ';
    } else {
      prevSpace = false;
      out += c;
    }
  }
  return out;
}

/** exactly one space after a code comma. */
export function spaceAfterComma(code: string): string {
  const mask = codeMask(code);
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    out += c;
    if (c === ',' && mask[i]) {
      let j = i + 1;
      while (j < code.length && code[j] === ' ' && mask[j]) { j++; }
      if (j < code.length) { out += ' '; }
      i = j - 1;
    }
  }
  return out;
}

/** no space before a code semicolon. */
export function noSpaceBeforeSemicolon(code: string): string {
  const mask = codeMask(code);
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === ';' && mask[i]) {
      out = out.replace(/[ \t]+$/, '');
    }
    out += c;
  }
  return out;
}

/** strip trailing whitespace (whole line, safe: a trailing space is never inside a closed string). */
export function stripTrailing(line: string): string {
  return line.replace(/[ \t]+$/, '');
}

/**
 * exactly one space after the comment '#': `#foo` -> `# foo`.
 * Only the first '#' at the real comment position (via commentStart) is touched,
 * and only when a non-space/non-'#' char follows directly. Multi-# separator
 * lines (`####section####`) are left untouched.
 */
export function spaceAfterCommentHash(line: string): string {
  const ci = commentStart(line);
  if (ci < 0) { return line; }
  const next = line[ci + 1];
  if (next === undefined || next === ' ' || next === '\t' || next === '#') { return line; }
  return line.slice(0, ci + 1) + ' ' + line.slice(ci + 1);
}

/** collapse runs of more than 2 consecutive blank (whitespace-only) lines to exactly 2. */
export function collapseBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  let blanks = 0;
  for (const l of lines) {
    if (l.trim() === '') {
      blanks++;
      if (blanks <= 2) { out.push(l); }
    } else {
      blanks = 0;
      out.push(l);
    }
  }
  return out;
}

const MULTI3_OPS = ['@<>', '@>=', '@<='];
// `=>` is the TM1-rules feeder operator. Listed as a 2-char op so operatorSpacing
// keeps it atomic (`a=>b` → `a => b`) instead of splitting into `=` + `>`.
// It never occurs in TI logic, so this is inert for the TI formatter.
const MULTI_OPS = ['<>', '>=', '<=', '@=', '@<', '@>', '=>'];
const SINGLE_OPS = new Set(['=', '<', '>', '*', '/', '&', '|']);

/** one space around clearly-binary operators. Conservative: skips unary-ambiguous +/-. */
export function operatorSpacing(code: string): string {
  const mask = codeMask(code);
  let out = '';
  for (let i = 0; i < code.length; i++) {
    if (mask[i]) {
      const three = code.slice(i, i + 3);
      if (MULTI3_OPS.includes(three) && mask[i + 1] && mask[i + 2]) {
        out = out.replace(/ +$/, '') + ' ' + three + ' ';
        i += 2;
        while (i + 1 < code.length && code[i + 1] === ' ' && mask[i + 1]) { i++; }
        continue;
      }
      const two = code.slice(i, i + 2);
      if (MULTI_OPS.includes(two) && mask[i + 1]) {
        out = out.replace(/ +$/, '') + ' ' + two + ' ';
        i += 1;
        while (i + 1 < code.length && code[i + 1] === ' ' && mask[i + 1]) { i++; }
        continue;
      }
      const c = code[i];
      if (SINGLE_OPS.has(c)) {
        out = out.replace(/ +$/, '') + ' ' + c + ' ';
        while (i + 1 < code.length && code[i + 1] === ' ' && mask[i + 1]) { i++; }
        continue;
      }
    }
    out += code[i];
  }
  return out;
}

/** normalize spacing just inside ( and ). `off` is handled by the caller (not invoked). */
export function parenSpacing(code: string, style: 'tight' | 'spaced'): string {
  const mask = codeMask(code);
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' && mask[i]) {
      out += '(';
      let j = i + 1;
      while (j < code.length && code[j] === ' ' && mask[j]) { j++; }
      if (j < code.length && code[j] === ')' && mask[j]) { i = j - 1; continue; } // empty ()
      if (style === 'spaced') { out += ' '; }
      i = j - 1;
      continue;
    }
    if (c === ')' && mask[i]) {
      out = out.replace(/ +$/, '');
      if (style === 'spaced' && !/\($/.test(out)) { out += ' '; }
      out += ')';
      continue;
    }
    out += c;
  }
  return out;
}

/** split a line into one statement per line at code-level semicolons. */
export function splitStatements(line: string): string[] {
  const ci = commentStart(line);
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const mask = codeMask(code);

  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < code.length; i++) {
    cur += code[i];
    if (code[i] === ';' && mask[i]) {
      parts.push(cur.trim());
      cur = '';
    }
  }
  const tail = cur.trim();
  if (tail) { parts.push(tail); }

  if (parts.length === 0) {
    return [line]; // comment-only or blank line
  }
  if (comment) {
    parts[parts.length - 1] = (parts[parts.length - 1] + ' ' + comment.trim()).trim();
  }
  return parts;
}

const CONTROL_KEYWORDS: Record<string, { upper: string; lower: string; camel: string }> = {
  if:     { upper: 'IF',     lower: 'if',     camel: 'If' },
  while:  { upper: 'WHILE',  lower: 'while',  camel: 'While' },
  else:   { upper: 'ELSE',   lower: 'else',   camel: 'Else' },
  elseif: { upper: 'ELSEIF', lower: 'elseif', camel: 'ElseIf' },
  endif:  { upper: 'ENDIF',  lower: 'endif',  camel: 'EndIf' },
  end:    { upper: 'END',    lower: 'end',    camel: 'End' },
};

function sigSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const WRAP_CALL_RE = /\b(ExecuteProcess|RunProcess)[ \t]*\(/i;

/** `s` with every non-code char (strings, comments, [...] refs) replaced by a
 *  space. Length-preserving. Single masking source; see codeMask. */
export function maskedCopy(s: string): string {
  const mask = codeMask(s);
  let out = '';
  for (let i = 0; i < s.length; i++) { out += mask[i] ? s[i] : ' '; }
  return out;
}

/** Net code-level paren balance of one line (strings/comments/brackets ignored). */
function codeParenBalance(line: string): number {
  const masked = maskedCopy(line);
  let bal = 0;
  for (const c of masked) {
    if (c === '(') { bal++; }
    else if (c === ')') { bal--; }
  }
  return bal;
}

/** Split an arg-list string at top-level code commas (string-/paren-aware). Args come back trimmed. */
export function splitTopLevelArgs(argsStr: string): string[] {
  if (!argsStr.trim()) { return []; }
  const mask = codeMask(argsStr);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < argsStr.length; i++) {
    const c = argsStr[i];
    if (mask[i]) {
      if (c === '(') { depth++; }
      else if (c === ')') { depth--; }
      else if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    }
    cur += c;
  }
  parts.push(cur.trim());
  return parts.filter(a => a !== '');
}

/**
 * wrap long ExecuteProcess/RunProcess calls (opt-in).
 *
 * Runs as the LAST pipeline step (after the block-indent step) on the line array:
 * the per-line content rules and block-indent know nothing about multi-line calls,
 * so wrap-long-calls owns the continuation indent itself.
 *
 * - Wraps only lines whose code part contains a complete Execute/RunProcess
 *   call, are longer than `wrapColumn`, and have >= 2 param pairs after the
 *   process name. One `'pName', value` pair per continuation line; an odd
 *   leftover arg is appended to the last pair. `);` stays on the last line.
 * - Continuation indent = head-line indent + indentUnit.
 * - Whitespace just inside the call parens is preserved from the (already
 *   content-formatted) source line, so parenStyle 'spaced' stays idempotent.
 * - Lines with a trailing comment are exempt from wrapping (simplest
 *   idempotent variant — no comment relocation).
 * - Already-wrapped calls (head line with open paren balance > 0) are NOT
 *   re-wrapped; instead their continuation lines are re-indented to
 *   head indent + indentUnit. This restores the continuation indent that
 *   block-indent (which indents purely by IF/WHILE depth) flattens, making the
 *   block-indent + wrap-long-calls pipeline idempotent.
 */
export function wrapLongCalls(lines: string[], indentUnit: string, wrapColumn: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const masked = maskedCopy(line);
    const m = WRAP_CALL_RE.exec(masked);
    if (!m) { out.push(line); continue; }

    const indent = (/^[ \t]*/.exec(line) as RegExpExecArray)[0];
    const contIndent = indent + indentUnit;

    // Already-wrapped (or manually multi-line) call: consume + re-indent continuation lines.
    let bal = codeParenBalance(line);
    if (bal > 0) {
      out.push(line);
      while (bal > 0 && i + 1 < lines.length) {
        i++;
        bal += codeParenBalance(lines[i]);
        out.push(contIndent + lines[i].replace(/^[ \t]+/, ''));
      }
      continue;
    }

    if (line.length <= wrapColumn) { out.push(line); continue; }
    if (commentStart(line) >= 0) { out.push(line); continue; } // trailing comment → exempt

    // Locate the call's open paren and its matching close paren (code-level).
    const open = masked.indexOf('(', m.index);
    let depth = 0;
    let close = -1;
    for (let j = open; j < line.length; j++) {
      if (masked[j] === '(') { depth++; }
      else if (masked[j] === ')') { depth--; if (depth === 0) { close = j; break; } }
    }
    if (close < 0) { out.push(line); continue; }

    const argsStr = line.slice(open + 1, close);
    const args = splitTopLevelArgs(argsStr);
    const rest = args.slice(1);
    if (args.length === 0 || rest.length < 4) { out.push(line); continue; } // < 2 param pairs

    const pairs: string[] = [];
    for (let k = 0; k < rest.length; k += 2) {
      if (k + 1 < rest.length) { pairs.push(rest[k] + ', ' + rest[k + 1]); }
      else { pairs[pairs.length - 1] += ', ' + rest[k]; } // odd leftover → append to last pair
    }

    const leadWs = (/^[ \t]*/.exec(argsStr) as RegExpExecArray)[0];
    const tailWs = (/[ \t]*$/.exec(argsStr) as RegExpExecArray)[0];
    out.push(line.slice(0, open + 1) + leadWs + args[0] + ',');
    for (let k = 0; k < pairs.length; k++) {
      const last = k === pairs.length - 1;
      out.push(contIndent + pairs[k] + (last ? tailWs + ')' + line.slice(close + 1) : ','));
    }
  }
  return out;
}

/** control-flow keywords -> chosen case; known TI functions -> canonical case; else untouched. */
export function keywordCasing(code: string, style: 'upper' | 'lower' | 'camel'): string {
  const mask = codeMask(code);
  return code.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (tok, offset: number) => {
    if (!mask[offset]) { return tok; }
    const lc = tok.toLowerCase();
    const kw = CONTROL_KEYWORDS[lc];
    if (kw) { return kw[style]; }
    const sig = KNOWN_SIGNATURES.get(sigSlug(tok));
    if (sig) { return sig.name; }
    return tok;
  });
}

/** Rewrite identifier tokens (code only — outside strings/comments/[...] refs) to
 *  their canonical spelling. Tokens absent from the map are left untouched. */
export function normalizeIdentifierCase(code: string, canonical: Map<string, string>): string {
  if (canonical.size === 0) { return code; }
  const mask = codeMask(code);
  return code.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (tok, offset: number) => {
    if (!mask[offset]) { return tok; }
    const canon = canonical.get(tok.toLowerCase());
    return canon ?? tok;
  });
}
