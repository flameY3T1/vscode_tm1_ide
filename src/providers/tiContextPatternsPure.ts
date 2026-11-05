/**
 * Pure (no-vscode) helpers for context-aware TI completion.
 * Exported separately so unit tests can import without pulling in the vscode mock.
 */
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

// ── Endpoint at the cursor ───────────────────────────────────────────────────

/** Parameter name → collection the suggestions come from. */
const ENDPOINT_BY_PARAM = new Map<string, 'Cubes' | 'Dimensions' | 'Processes'>([
  ['cubename', 'Cubes'],
  ['dimensionname', 'Dimensions'],
  ['processname', 'Processes'],
]);

/**
 * Which collection the suggestions at the cursor come from — or `null`.
 *
 * Read FORWARD via `enclosingCall`, since 2026-09-20, like the hierarchy
 * detection below. Before that, there was a second path here: a built regexp
 * per signature and argument position that searched the text BACKWARD. The
 * comment there justified itself why that fails on quotation marks — and
 * left it standing anyway. Two detections for the same call means: two
 * places for every future edge case.
 *
 * What the switch corrects along the way:
 * - **Nested parentheses.** The old `ONE_ARG` could not handle them; a
 *   `CellGetN('Cube', Subst('a','b'), '` counted the arguments wrong.
 * - **The INNERMOST call wins.** The regexp searched somewhere to the left
 *   for its function name and thereby also hit an outer call the cursor
 *   was no longer inside.
 * - **Several name parameters.** The old derivation took only the FIRST
 *   matching parameter per collection (`break`); here, the position the
 *   cursor is actually at counts.
 */
export function getTiContextEndpoint(before: string): 'Cubes' | 'Dimensions' | 'Processes' | null {
  const call = enclosingCall(before);
  if (!call) { return null; }
  const sig = KNOWN_SIGNATURES.get(call.name.toLowerCase());
  if (!sig) { return null; }
  // The cursor is in the LAST argument, and specifically in an open
  // string — an already-closed argument no longer wants a list.
  const idx = call.args.length - 1;
  if (!/'[^']*$/.test(call.args[idx])) { return null; }
  const pname = sig.params[idx]?.name.toLowerCase();
  return pname ? ENDPOINT_BY_PARAM.get(pname) ?? null : null;
}

// ── Hierarchies ──────────────────────────────────────────────────────────────
//
// A hierarchy name alone says nothing: `Hierarchies` only exists UNDER a
// dimension. Completion therefore needs both — the position in the call AND
// the dimension name from an earlier argument of the same call. That is
// exactly why this lives here and not in `CONTEXT_PATTERNS`: the other three
// endpoints work from position alone.

/** funcName (lower case) → argument position of the hierarchy name and of the dimension name. */
const HIERARCHY_FUNCS: Map<string, { hierIdx: number; dimIdx: number }> = (() => {
  const map = new Map<string, { hierIdx: number; dimIdx: number }>();
  for (const sig of KNOWN_SIGNATURES.values()) {
    const names = sig.params.map(p => p.name.toLowerCase());
    const hierIdx = names.indexOf('hierarchyname');
    const dimIdx = names.indexOf('dimensionname');
    if (hierIdx === -1 || dimIdx === -1 || dimIdx > hierIdx) { continue; }
    map.set(sig.name.toLowerCase(), { hierIdx, dimIdx });
  }
  return map;
})();

/**
 * The call the cursor is in: the function name and the arguments before it.
 *
 * Read FORWARD, not backward. Backward flips the quote counting: the cursor
 * sits in an OPEN string, so its count is odd, and every character to its
 * left is wrongly treated as part of a string — the call's opening
 * parenthesis is never seen.
 */
function enclosingCall(before: string): { name: string; args: string[] } | null {
  const stack: Array<{ name: string; argsStart: number }> = [];
  let inString = false;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === "'") { inString = !inString; continue; }
    if (inString) { continue; }
    if (ch === '(') {
      const name = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(before.slice(0, i))?.[1] ?? '';
      stack.push({ name, argsStart: i + 1 });
    } else if (ch === ')') {
      stack.pop();
    }
  }
  const top = stack[stack.length - 1];
  if (!top || top.name === '') { return null; }
  return { name: top.name, args: splitArgs(before.slice(top.argsStart)) };
}

/** Split the argument list at the TOP-level commas. */
function splitArgs(rest: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  for (const ch of rest) {
    if (ch === "'") { inString = !inString; current += ch; continue; }
    if (!inString) {
      if (ch === '(') { depth++; }
      else if (ch === ')') { depth--; }
      else if (ch === ',' && depth === 0) { args.push(current); current = ''; continue; }
    }
    current += ch;
  }
  args.push(current);
  return args;
}

/**
 * Is the cursor in a hierarchy argument? Then the dimension that goes with it.
 *
 * `null` when the position does not fit OR the dimension in the call is not a
 * fixed string (a variable, say) — then there is nothing to fetch, and a
 * list from a different dimension would be worse than none.
 */
export function getTiHierarchyContext(before: string): { dimension: string } | null {
  const call = enclosingCall(before);
  if (!call) { return null; }
  const at = HIERARCHY_FUNCS.get(call.name.toLowerCase());
  if (!at) { return null; }
  // The cursor is in the LAST argument, and specifically in an open string.
  if (call.args.length - 1 !== at.hierIdx) { return null; }
  if (!/'[^']*$/.test(call.args[at.hierIdx])) { return null; }
  const dim = /^\s*'([^']*)'\s*$/.exec(call.args[at.dimIdx] ?? '')?.[1];
  return dim ? { dimension: dim } : null;
}
