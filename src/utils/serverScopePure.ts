/**
 * The server scope of a snippet or a process template — pure,
 * without `vscode` (depcruise `pure-no-vscode`).
 *
 * Both stores carry the same field `servers?: string` (semicolon list of
 * TM1 server names, empty = visible everywhere) and had the comparison for it
 * spelled out **twice verbatim**. Two copies of a visibility rule
 * are the kind of duplication that drifts apart without any test
 * failing: each half on its own stays correct.
 */

/**
 * Is the entry visible for the active server?
 *
 * @param scope   Content of the `servers` field. Empty/undefined ⇒ always visible.
 * @param active Display name of the connected server, `undefined` if none
 *                is connected — then a restricted entry is NOT
 *                visible (there is no way to check whether it would match).
 */
export function matchesServerScope(
  scope: string | undefined,
  active: string | undefined,
): boolean {
  if (!scope || !scope.trim()) { return true; }
  if (!active) { return false; }
  const allowed = scope.split(';').map(n => n.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(active.toLowerCase());
}
