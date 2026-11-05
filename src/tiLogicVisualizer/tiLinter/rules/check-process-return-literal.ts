import { LintDiagnose } from '../../lintTypes';

/**
 * Numeric value of each ProcessExit*() function, measured 2026-10-29 with
 * the live probe `v12ExitSemanticsProbe.js` on TM1 11.8.02900.8 and on
 * PA as a Service 12.6.4. Identical up to ProcessExitByQuit; from
 * ProcessExitSeriousError on, v12 is shifted by one.
 *
 * `3` has no function on either version: it is what ExecuteProcess returns when the
 * child calls ItemSkip in the Prolog or Epilog (same on both — `wrong-section` covers it).
 */
const V11: Record<string, string> = {
  '0': 'ProcessExitNormal', '5': 'ProcessExitWithMessage', '7': 'ProcessExitMinorError',
  '8': 'ProcessExitByBreak', '9': 'ProcessExitByQuit', '11': 'ProcessExitSeriousError',
  '12': 'ProcessExitOnInit', '17': 'ProcessExitByChoreQuit', '20': 'ProcessExitByProcessRollback',
  '21': 'ProcessExitByChoreRollback',
};
const V12: Record<string, string> = {
  '0': 'ProcessExitNormal', '5': 'ProcessExitWithMessage', '7': 'ProcessExitMinorError',
  '8': 'ProcessExitByBreak', '9': 'ProcessExitByQuit', '12': 'ProcessExitSeriousError',
  '13': 'ProcessExitOnInit', '18': 'ProcessExitByChoreQuit', '21': 'ProcessExitByProcessRollback',
  '22': 'ProcessExitByChoreRollback',
};

const CALL = '\u0001EP\u0001';
const ASSIGN_RE = /^\s*([A-Za-z_][\w.$]*)\s*=\s*\u0001EP\u0001/;
const COND_RE = /\b(?:ELSEIF|IF|WHILE)\s*\(/i;

/** Replace every `ExecuteProcess(…)` (balanced parentheses) with a marker. */
function markCalls(line: string): string {
  const re = /\bExecuteProcess\s*\(/gi;
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < line.length && depth > 0; i++) {
      if (line[i] === '(') { depth++; } else if (line[i] === ')') { depth--; }
    }
    out += line.slice(from, m.index) + CALL;
    from = i;
    re.lastIndex = i;
  }
  return out + line.slice(from);
}

const escape = (s: string) => s.replace(/[.$]/g, '\\$&');
const label = (fn: string | undefined) => (fn ? `${fn}()` : 'no ProcessExit code');

/**
 * Post-traversal check: `process-return-code-literal` where an ExecuteProcess result (the call
 * itself or a variable assigned from it in this section) is compared against a number that
 * means something else on v11 than on v12. Not gated on V12 mode: the fix — compare against
 * the ProcessExit*() function — is correct on both, and the literal silently breaks the day
 * the server is migrated.
 *
 * ponytail: per-section text scan, a variable assigned in the Prolog and compared in the
 * Epilog is not seen; carry the names across sections via LintOptions if that shows up.
 */
export function checkProcessReturnLiterals(rawCode: string | undefined, diagnostics: LintDiagnose[]): void {
  if (!rawCode || !/ExecuteProcess/i.test(rawCode)) { return; }
  const lines = rawCode.split('\n').map((l) => markCalls(l.replace(/'(?:[^']|'')*'/g, "''").replace(/#.*$/, '')));
  const subjects = [escape(CALL)];
  for (const l of lines) {
    const a = ASSIGN_RE.exec(l);
    if (a) { subjects.push(`\\b${escape(a[1])}\\b`); }
  }
  const subj = `(?:${subjects.join('|')})`;
  const cmp = new RegExp(`${subj}\\s*(?:<>|<=|>=|=|<|>)\\s*(\\d+)\\b|\\b(\\d+)\\s*(?:<>|<=|>=|=|<|>)\\s*${subj}`, 'gi');
  for (let i = 0; i < lines.length; i++) {
    if (!COND_RE.test(lines[i])) { continue; }
    cmp.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = cmp.exec(lines[i])) !== null) {
      const code = String(Number(m[1] ?? m[2]));
      if (V11[code] === V12[code]) { continue; }
      diagnostics.push({
        line: i + 1,
        severity: 'warning',
        ruleId: 'process-return-code-literal',
        messageKey: `Return code {0} is {1} on TM1 11 but {2} on TM1 12 — compare against the ProcessExit…() function instead of the number.`,
        messageArgs: [code, label(V11[code]), label(V12[code])],
      });
    }
  }
}
