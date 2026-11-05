import * as vscode from 'vscode';

/**
 * Structural shape shared by `LintDiagnose` (TI linter) and
 * `RulesLintDiagnose` (cube-rules linter). Both emit a stable `ruleId` plus
 * either a baked `message` (legacy) or `messageKey`/`messageArgs` (localizable).
 */
interface LocalizableLintDiag {
  ruleId: string;
  message?: string;
  messageKey?: string;
  messageArgs?: (string | number)[];
}

/**
 * Renders a lint diagnostic to its final, localized display string.
 *
 * Pure linter rules emit a stable `ruleId` plus an English `messageKey`
 * (with {0} placeholders) and `messageArgs`. This boundary translates the
 * key via `vscode.l10n.t` and prepends the `[rule-id]` tag, matching the
 * historical `[rule-id] message` format shown in the Problems panel.
 *
 * Legacy diagnostics that still carry a baked `message` (German, prefix
 * included) are passed through unchanged until they are migrated.
 */
export function renderLintMessage(d: LocalizableLintDiag): string {
  if (d.messageKey) {
    const body = vscode.l10n.t(d.messageKey, ...(d.messageArgs ?? []).map(String));
    return `[${d.ruleId}] ${body}`;
  }
  return d.message ?? '';
}

/**
 * Returns a copy of the diagnostics with `message` populated from the
 * localized render. Call this once at every extension-side boundary that
 * forwards lint results to a webview (which displays `d.message` directly).
 * Diagnostics without a `messageKey` are returned unchanged.
 */
export function localizeLintDiagnostics<T extends LocalizableLintDiag>(diags: T[]): T[] {
  return diags.map(d => (d.messageKey ? { ...d, message: renderLintMessage(d) } : d));
}

/**
 * Extraction anchor for `@vscode/l10n-dev export`.
 *
 * Lint rules emit `messageKey` as plain string literals (they are pure and
 * vscode-free), so the extractor cannot see them at the `vscode.l10n.t(key)`
 * call site (the argument is a variable). This function is never executed; it
 * only lists every lint messageKey as a literal `vscode.l10n.t(...)` call so
 * the extractor registers them in the EN bundle. Keep it in sync with the
 * `messageKey` strings used across `tiLinter/rules/*`.
 */
/* istanbul ignore next */
function _lintMessageKeyAnchor(): void {
  vscode.l10n.t('ExecuteCommand should be avoided for security reasons.');
  vscode.l10n.t(`{0}() only reaches the database content directory in TM1 / Planning Analytics v12 — '{1}' climbs out of it.`);
  vscode.l10n.t(`Return code {0} is {1} on TM1 11 but {2} on TM1 12 — compare against the ProcessExit…() function instead of the number.`);
  vscode.l10n.t(`'{0}' should use a string-literal process name.`);
  vscode.l10n.t('ODBCOpen password should be a defined TI parameter, not a literal.');
  vscode.l10n.t('Code after ProcessQuit is unreachable.');
  vscode.l10n.t(`'{0}' is a parameter/datasource field and should not be overwritten.`);
  vscode.l10n.t(`'{0}' in the Data section fires per record — belongs in the Epilog.`);
  vscode.l10n.t(`'{0}' is only allowed in the Metadata or Data section (current section: {1}).`);
  vscode.l10n.t(`'{0}' only takes effect in the Prolog — the assignment in the {1} section has no effect.`);
  vscode.l10n.t(`'{0}' without error handling — guard it with IF(CellIsUpdateable(...)=1, ...) or check ProcessError afterwards.`);
  vscode.l10n.t(`A WHILE condition should be preceded by an explanatory # comment.`);
  vscode.l10n.t(`An IF condition should be preceded by an explanatory # comment.`);
  vscode.l10n.t(`Condition '{0}' is always false — this IF branch is never executed.`);
  vscode.l10n.t(`Condition '{0}' is always true — ELSE/ELSEIF branches are unreachable.`);
  vscode.l10n.t(`CubeSetLogChanges({0}, 0) without a matching restore — logging stays off after the process ends.`);
  vscode.l10n.t(`Datasource variable '{0}' should start with '{1}'.`);
  vscode.l10n.t(`ELSEIF condition '{0}' is always false — this branch is never executed.`);
  vscode.l10n.t(`Empty IF block with no statements.`);
  vscode.l10n.t(`Empty WHILE block with no statements.`);
  vscode.l10n.t(`Function '{0}' expects {1} argument(s), but received {2}.`);
  vscode.l10n.t(`Function '{0}': parameter {1} expects type '{2}', but received '{3}'.`);
  vscode.l10n.t(`Hardcoded file path '{0}' — should be passed in as a TI parameter, not embedded in the source.`);
  vscode.l10n.t(`Numeric comparison using string operator '{0}' — use '{1}' instead.`);
  vscode.l10n.t(`Object name '{0}' contains the character '{1}' which is not allowed in TM1 (forbidden: ) | ~ ; @ \\ / : * ? " < > !).`);
  vscode.l10n.t(`Parameter '{0}' should start with '{1}'.`);
  vscode.l10n.t(`Potential endless loop: condition '{0}' — none of the referenced variables are modified in the loop body.`);
  vscode.l10n.t(`Process calls itself — possible infinite recursion without a termination condition.`);
  vscode.l10n.t(`Prolog should start with a comment block (docstring).`);
  vscode.l10n.t(`String comparison using numeric operator '{0}' — use '@{0}' instead.`);
  vscode.l10n.t(`String contains '%{0}%' but is not interpolated through Expand().`);
  vscode.l10n.t(`The return value of ExecuteProcess is ignored — errors in sub-processes go unnoticed (check ProcessExitByQuit etc.).`);
  vscode.l10n.t(`Unknown function '{0}'.`);
  vscode.l10n.t(`Argument '{0}' for '{1}' is invalid — allowed: {2}.`);
  vscode.l10n.t(`Variable '{0}' contains umlauts or ß — please avoid using them.`);
  vscode.l10n.t(`Variable '{0}' is assigned but never used.`);
  vscode.l10n.t(`Variable '{0}' is of type '{1}', but the assigned value is of type '{2}'.`);
  vscode.l10n.t(`Variable '{0}' is overwritten without being read first.`);
  vscode.l10n.t(`{0} is created but never destroyed — use ViewDestroy/SubsetDestroy in the Epilog or set the temp flag.`);
  vscode.l10n.t(`{0} variable '{1}' should start with '{2}'.`);
  vscode.l10n.t(`{0} with exclusively constant arguments — the value does not change per iteration, better cache it in a variable in the Prolog.`);
  // rulesLinter (cube rules)
  vscode.l10n.t('Invalid Rules statement — expected `[cell reference] = expression;` or a `C:`/`N:`/`S:` marker.');
  vscode.l10n.t('Invalid Feeder statement — expected `[cell reference] => target(s);`.');
  vscode.l10n.t('DB() is invalid on the left side of a feeder. The source cell reference must be [...], DB() only on the right side.');
  vscode.l10n.t('Rule line (C:/N:/S:) after FEEDERS; — rules belong before the FEEDERS block.');
  vscode.l10n.t('Statement does not end with a semicolon.');
  vscode.l10n.t('No FEEDERS; block found. Without feeders no rules are calculated.');
  vscode.l10n.t('Multiple FEEDERS; markers found. Only the first one is recognized by TM1.');
  vscode.l10n.t('Unclosed square bracket `[`.');
  vscode.l10n.t('Missing comma between feeder targets.');
  vscode.l10n.t('The left side of a feeder must be a single cell reference, not several.');
  vscode.l10n.t('Feeder line without `=>` operator.');
  vscode.l10n.t('DB() needs at least 2 arguments (cube name + 1 dimension).');
  vscode.l10n.t('First DB() argument is a function call instead of a string literal — possibly intentional (e.g. to conditionally disable a feeder).');
  vscode.l10n.t('First DB() argument must be a string literal (cube name in single quotes).');
  vscode.l10n.t(`'{0}' does not match the format 'Dimension':'Element', 'Dimension':'Hierarchy':'Element' or 'Dimension':{'E1','E2'}.`);
  vscode.l10n.t(`Cell reference does not match the format ['Dimension':'Element'], ['Dimension':'Hierarchy':'Element'] or ['Dimension':{'E1','E2'}].`);
  // rulesLinter server-side (lintServer.ts)
  vscode.l10n.t(`Cube '{0}' was not found on the server.`);
  vscode.l10n.t(`DB('{0}') expects {1} arguments ({2} dimension(s)), but got {3}.`);
  vscode.l10n.t(`Element '{0}' in dimension '{1}' (DB() arg {2}) not found.`);
  vscode.l10n.t(`Dimension '{0}' was not found on the server.`);
  vscode.l10n.t(`Hierarchy '{0}' in dimension '{1}' was not found on the server.`);
  vscode.l10n.t(`Element '{0}' in dimension '{1}' hierarchy '{2}' not found.`);
  vscode.l10n.t(`Element '{0}' in dimension '{1}' not found.`);
  // TI server linter (tiServerLinter.ts)
  vscode.l10n.t(`Cube '{0}' was not found on the server (in {1}()).`);
  vscode.l10n.t(`Dimension '{0}' was not found on the server (in {1}()).`);
  vscode.l10n.t(`Process '{0}' was not found on the server (in {1}()).`);
  vscode.l10n.t(`Process '{0}' has no parameter '{1}' (available: {2}).`);
  // tiParser ParseError
  vscode.l10n.t('Duplicate semicolon: each statement needs exactly one semicolon');
  vscode.l10n.t('Unexpected ENDIF without a matching IF');
  vscode.l10n.t('Unexpected END without a matching WHILE');
  vscode.l10n.t('Unexpected {0} without a matching IF');
  vscode.l10n.t(`Empty assignment: "{0}" has no value (e.g. {1} = 1; or {2} = 'text';)`);
  vscode.l10n.t('Missing semicolon at end of line');
  vscode.l10n.t('Unknown statement: "{0}" — expected an assignment (var = expr;), a function call (Fn(...);), or a keyword');
  vscode.l10n.t('Missing ENDIF — IF block was not closed');
  vscode.l10n.t('Missing END — WHILE block was not closed');
  // undefined-variable (built inline in the lint providers)
  vscode.l10n.t('Variable "{0}" is not defined (no parameter, no datasource variable, no assignment in the code)');
  // inconsistent-var-casing (built inline in the lint providers)
  vscode.l10n.t(`Identifier '{0}' should be spelled '{1}' for consistency.`);
}
void _lintMessageKeyAnchor;
