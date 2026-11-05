/**
 * Pure (vscode-free) validation helpers for TI rename.
 *
 * Extracted from `tiRenameProvider.ts` so the policy decisions
 * (reserved names + identifier-shape rules) are unit-testable in isolation.
 */

/** TI control-flow keywords and process-control statements. */
export const TI_RESERVED: ReadonlySet<string> = new Set([
  'if', 'elseif', 'else', 'endif', 'while', 'end', 'for', 'next',
  'processerror', 'processquit', 'processbreak', 'processabort',
  'itemreject', 'itemskip',
  'stringglobalvariable', 'numericglobalvariable',
]);

/** Valid TI identifier shape (matches the regex used by the rename provider). */
export const VALID_IDENTIFIER_RE = /^[a-zA-ZÄÖÜäöüß_][a-zA-ZÄÖÜäöüß0-9_]*$/;

/**
 * Returns true if `lower` is a reserved TI keyword OR a built-in TI function.
 * `builtinNames` is the lower-cased set of known signature keys (passed in to
 * avoid module-load coupling with KNOWN_SIGNATURES).
 */
export function isReservedName(lower: string, builtinNames: ReadonlySet<string>): boolean {
  return TI_RESERVED.has(lower) || builtinNames.has(lower);
}

/** Returns true if `name` is shape-valid as a TI identifier. */
export function isValidIdentifier(name: string): boolean {
  return VALID_IDENTIFIER_RE.test(name);
}

/**
 * Full rename-target validation: returns null if OK, otherwise an error message.
 * Encapsulates the three pre-checks the provider does on prepareRename + provideRenameEdits.
 */
export function validateRenameTarget(
  oldName: string,
  newName: string,
  builtinNames: ReadonlySet<string>,
): string | null {
  if (isReservedName(oldName.toLowerCase(), builtinNames)) {
    return 'Built-in functions and keywords cannot be renamed.';
  }
  const trimmed = newName.trim();
  if (!trimmed) { return 'New name must not be empty.'; }
  if (!isValidIdentifier(trimmed)) { return 'Invalid identifier.'; }
  if (isReservedName(trimmed.toLowerCase(), builtinNames)) {
    return 'New name collides with a built-in function or keyword.';
  }
  return null;
}
