/**
 * Lex-helper that scans TI source code (already paren-joined into single
 * logical lines via `joinContinuationLines`) and yields top-level
 * function-call sites: `<identifier>(<args>);`.
 *
 * Concerns handled here:
 *  - String-literal awareness (single-quoted, doubled '' escape)
 *  - Comment awareness (#, //, block comments)
 *  - Bracket-depth tracking for nested calls
 *  - Returns position spans + raw arg-string for downstream argument parsing
 *
 * Out of scope:
 *  - Argument splitting (delegated to splitArgs)
 *  - Statement boundaries other than `;`
 */

export type CallSite = {
  /** Function-name as written (case preserved). */
  name: string;
  /** Char offset of identifier start in input. */
  start: number;
  /** Char offset just past `)` (inclusive of close paren). */
  end: number;
  /** Raw substring inside the outermost parentheses (no leading/trailing space trim). */
  argString: string;
};

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

type ScanState = {
  inString: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
};

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}

/**
 * Scan source and emit every top-level call site (i.e. depth-0 calls). Nested
 * calls inside argument lists are NOT yielded — the caller decides whether
 * they need to recurse into argString.
 */
export function findCallSites(source: string): CallSite[] {
  const sites: CallSite[] = [];
  const state: ScanState = { inString: false, inLineComment: false, inBlockComment: false };

  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (state.inLineComment) {
      if (c === '\n') state.inLineComment = false;
      i++;
      continue;
    }
    if (state.inBlockComment) {
      if (c === '*' && next === '/') {
        state.inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (state.inString) {
      if (c === "'") {
        if (next === "'") {
          i += 2;
          continue;
        }
        state.inString = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (c === '#') {
      state.inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      state.inLineComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      state.inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      state.inString = true;
      i++;
      continue;
    }

    if (isIdentStart(c)) {
      const identStart = i;
      IDENT_RE.lastIndex = i;
      const m = IDENT_RE.exec(source);
      if (!m) {
        i++;
        continue;
      }
      const ident = m[0];
      let j = identStart + ident.length;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
      if (source[j] !== '(') {
        i = identStart + ident.length;
        continue;
      }

      const argStart = j + 1;
      let depth = 1;
      const inner: ScanState = { inString: false, inLineComment: false, inBlockComment: false };
      let k = argStart;
      while (k < source.length && depth > 0) {
        const cc = source[k];
        const nn = source[k + 1];

        if (inner.inLineComment) {
          if (cc === '\n') inner.inLineComment = false;
          k++;
          continue;
        }
        if (inner.inBlockComment) {
          if (cc === '*' && nn === '/') {
            inner.inBlockComment = false;
            k += 2;
            continue;
          }
          k++;
          continue;
        }
        if (inner.inString) {
          if (cc === "'") {
            if (nn === "'") {
              k += 2;
              continue;
            }
            inner.inString = false;
            k++;
            continue;
          }
          k++;
          continue;
        }

        if (cc === '#') {
          inner.inLineComment = true;
          k++;
          continue;
        }
        if (cc === '/' && nn === '/') {
          inner.inLineComment = true;
          k += 2;
          continue;
        }
        if (cc === '/' && nn === '*') {
          inner.inBlockComment = true;
          k += 2;
          continue;
        }
        if (cc === "'") {
          inner.inString = true;
          k++;
          continue;
        }
        if (cc === '(') {
          depth++;
          k++;
          continue;
        }
        if (cc === ')') {
          depth--;
          k++;
          continue;
        }
        k++;
      }

      if (depth === 0) {
        const argString = source.slice(argStart, k - 1);
        sites.push({ name: ident, start: identStart, end: k, argString });
        i = k;
        continue;
      }

      i = identStart + ident.length;
      continue;
    }

    i++;
  }

  return sites;
}

/**
 * Split a TI argument-string at top-level commas. Honors string literals,
 * nested parens, and comments inside the args. Returns trimmed args.
 */
export function splitArgs(argString: string): string[] {
  const args: string[] = [];
  let buf = '';
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < argString.length; i++) {
    const c = argString[i];
    const n = argString[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      buf += c;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        buf += c + n;
        i++;
        continue;
      }
      buf += c;
      continue;
    }
    if (inString) {
      buf += c;
      if (c === "'") {
        if (n === "'") {
          buf += n;
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (c === '#') {
      inLineComment = true;
      buf += c;
      continue;
    }
    if (c === '/' && n === '/') {
      inLineComment = true;
      buf += c + n;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlockComment = true;
      buf += c + n;
      i++;
      continue;
    }
    if (c === "'") {
      inString = true;
      buf += c;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      continue;
    }
    if (c === ')') {
      depth--;
      buf += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      args.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }

  if (buf.trim() !== '' || args.length > 0) {
    args.push(buf.trim());
  }
  return args;
}

/**
 * Convert a 0-based char-offset into 1-based (line, col).
 */
export function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const stop = Math.min(offset, source.length);
  for (let i = 0; i < stop; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
