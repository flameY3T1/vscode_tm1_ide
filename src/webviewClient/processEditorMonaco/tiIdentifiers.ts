import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';

const CONTROL_KEYWORDS = new Set([
  'if', 'elseif', 'else', 'endif', 'while', 'end', 'for', 'next',
]);
const STATEMENT_KEYWORDS = new Set([
  'processerror', 'processquit', 'processbreak',
  'itemreject', 'itemskip',
  'stringglobalvariable', 'numericglobalvariable',
]);

let _builtinNames: Set<string> | null = null;
function getBuiltinNames(): Set<string> {
  if (!_builtinNames) {
    _builtinNames = new Set(Array.from(KNOWN_SIGNATURES.keys()).map((k) => k.toLowerCase()));
  }
  return _builtinNames;
}

/** Replace string-literal bodies and `#` comments with spaces so an identifier
 *  scan doesn't pick up text inside strings or comments. */
export function stripStringsAndComments(text: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      out += ' ';
      if (ch === "'") {
        if (text[i + 1] === "'") { out += ' '; i += 2; continue; }
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === "'") { inStr = true; out += ' '; i++; continue; }
    out += ch;
    i++;
  }
  return out;
}

/** Distinct user identifiers across the given texts: length ≥ 2, excluding TI
 *  control/statement keywords and known builtins. First-seen casing preserved. */
export function collectIdentifierNames(texts: string[]): string[] {
  const identRe = /[A-Za-z_][A-Za-z0-9_]*/g;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const text of texts) {
    const stripped = stripStringsAndComments(text);
    identRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(stripped)) !== null) {
      const ident = m[0];
      const lower = ident.toLowerCase();
      if (lower.length < 2) { continue; }
      if (CONTROL_KEYWORDS.has(lower)) { continue; }
      if (STATEMENT_KEYWORDS.has(lower)) { continue; }
      if (getBuiltinNames().has(lower)) { continue; }
      if (seen.has(lower)) { continue; }
      seen.add(lower);
      result.push(ident);
    }
  }
  return result;
}
