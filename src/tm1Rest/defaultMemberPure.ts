// src/tm1Rest/defaultMemberPure.ts
//
// Pure building blocks for a hierarchy's default element. No `vscode`, no
// REST — the depcruise rule `pure-no-vscode` enforces the first, testability
// the second.
//
// All three forms below are measured live against TM1 11.8.02900.8
// (defaultMemberProbe{4,7,8,9}.js), not taken from the
// documentation: the IBM and Cubewise descriptions are silent on how to
// address secondary hierarchies.
//
// Both escapes delegate to the existing, tested helpers instead of
// reimplementing them: the guard `src/test/noInlineEscape.test.ts` (D1)
// forbids any inline `'`→`''` or `]`→`]]` outside of
// `utils/{odataKey,tiLiteral}`. The detour through `escapeTiLiteral`
// additionally brings along the rejection of control characters — TI has no
// escape sequence for those, and a line break in the name would break the
// literal open.
import { escapeTiLiteral } from '../utils/tiLiteral';
import { escapeMdx } from '../utils/odataKey';

/**
 * Entry in the control dimension `}Dimensions` that addresses both the
 * dimension AND the hierarchy. The hierarchy with the same name (the
 * default hierarchy) is under the plain dimension name; every other one is
 * under `dim:hier`. The obvious form `dim:dim` for the default hierarchy
 * does NOT exist — a write attempt against it ends in `HasMinorErrors`.
 */
export function dimensionToken(dim: string, hier: string): string {
  return hier.toLowerCase() === dim.toLowerCase() ? dim : `${dim}:${hier}`;
}

/** TI string escape: `'` → `''`. Throws on control characters (see `escapeTiLiteral`). */
export function tiEscape(s: string): string {
  return escapeTiLiteral(s);
}

/**
 * Set OR reset (`member === ''`) inside a prolog.
 *
 * Both lines are mandatory: without `RefreshMdxHierarchy`, the cell that was
 * written has no effect anywhere — even a fresh session keeps seeing the old
 * value, because this is a server-side metadata rebuild, not a session
 * cache. The refresh MUST get the same token: refreshing the main dimension
 * does not activate a secondary hierarchy.
 */
export function buildSetDefaultMemberTi(token: string, member: string): string {
  const t = tiEscape(token);
  return `CellPutS('${tiEscape(member)}','}HierarchyProperties','${t}','hierarchy0','defaultMember');\r\n`
    + `RefreshMdxHierarchy('${t}');`;
}

/**
 * Reads the EXPLICITLY set default elements of several hierarchies in one
 * go. The cube contains only what is explicitly set — on the test server, 82
 * of 88 hierarchies had an effective default member, but exactly one had one
 * that was set. The cell order follows the row axis, i.e. the token order.
 */
export function buildExplicitReadMdx(tokens: string[]): string {
  if (tokens.length === 0) { throw new Error('buildExplicitReadMdx: empty token list'); }
  const rows = tokens.map(t => `[}Dimensions].[${escapeMdx(t)}]`).join(',');
  return 'SELECT {[}HierarchyProperties].[defaultMember]} ON 0, '
    + `{${rows}} ON 1 `
    + 'FROM [}HierarchyProperties] WHERE ([}Hierarchies].[hierarchy0])';
}
