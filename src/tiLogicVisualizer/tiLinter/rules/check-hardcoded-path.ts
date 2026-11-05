import { LintDiagnose } from '../../lintTypes';

/**
 * Drive-letter path (`C:\…`, `C:/…`) or UNC path (`\\host\…`) inside a string
 * literal. The negative look-behind `(?<![A-Za-z])` keeps the drive-letter
 * branch from matching inside `http://`, `ftp://`, etc.
 */
const HARDCODED_PATH_RE = /(?<![A-Za-z])[A-Za-z]:[\\/][^\s']*|\\\\[^\\/\s'][^\s']*/;

/**
 * Post-traversal check: emit `hardcoded-path` for any string literal that
 * contains a hardcoded file or UNC path. Such paths break portability between
 * Dev/Test/Prod servers and should be passed in as TI parameters instead.
 *
 * Scans the raw source line-by-line, looking only inside single-quoted string
 * literals; `#`-comments and bare code are ignored.
 */
export function checkHardcodedPaths(rawCode: string | undefined, diagnostics: LintDiagnose[]): void {
  if (!rawCode) { return; }
  const lines = rawCode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const lit of extractStringLiterals(lines[i])) {
      const m = HARDCODED_PATH_RE.exec(lit);
      if (m) {
        diagnostics.push({
          line: i + 1,
          severity: 'warning',
          ruleId: 'hardcoded-path',
          messageKey: `Hardcoded file path '{0}' — should be passed in as a TI parameter, not embedded in the source.`,
          messageArgs: [m[0]],
        });
        break; // one diagnostic per line is enough
      }
    }
  }
}

/** Single-quoted string-literal bodies on a line, stopping at an unquoted `#` comment. */
function extractStringLiterals(line: string): string[] {
  const out: string[] = [];
  let inStr = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "'") {
        if (line[i + 1] === "'") { cur += "'"; i++; continue; } // escaped ''
        inStr = false;
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '#') { break; }
    if (c === "'") { inStr = true; cur = ''; }
  }
  return out;
}
