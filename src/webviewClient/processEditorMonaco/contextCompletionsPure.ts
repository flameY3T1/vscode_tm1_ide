/**
 * Pure helpers for process-editor context completions.
 *
 * Extracted from `contextCompletions.ts` (Hebel 17 — Iter 8). No Monaco,
 * no DOM, no module state.
 */

export {};

export interface ProcessParamInfo {
  name: string;
  type: 'Numeric' | 'String';
}

/**
 * Walk backwards through balanced parens from the end of `before` and return
 * the function name (word) directly preceding the outermost open paren.
 * Returns null when not inside a function call.
 *
 * Used to detect which TI function the cursor is currently inside, so the
 * context AC can offer cube/dim/process names instead of generic completions.
 */
export function getEnclosingFunctionName(before: string): string | null {
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ')') { depth++; }
    else if (ch === '(') {
      if (depth === 0) {
        let j = i - 1;
        while (j >= 0 && /\s/.test(before[j])) { j--; }
        const end = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(before[j])) { j--; }
        const start = j + 1;
        const word = before.slice(start, end);
        return word.length > 0 ? word : null;
      }
      depth--;
    }
  }
  return null;
}

/**
 * Build the insert text for a cube-with-dims completion in a TI process body.
 * Same as the rule-editor variant, except dims are resolved against the
 * process's declared variables: when a variable named `v<Dim>` exists
 * (case-insensitive), the variable name is inserted unquoted; otherwise a
 * quoted snippet placeholder.
 *
 * `varNamesLower` maps `name.toLowerCase()` → original `name` casing.
 */
export function buildCubeInsertTextWithVars(
  cubeName: string,
  dims: ReadonlyArray<string>,
  varNamesLower: ReadonlyMap<string, string>,
): { insertText: string; isSnippet: boolean } {
  let placeholderIdx = 1;
  const parts: string[] = [];
  for (const dim of dims) {
    const varName = varNamesLower.get(('v' + dim).toLowerCase());
    if (varName) {
      parts.push(varName);
    } else {
      parts.push(`'\${${placeholderIdx}:${dim}}'`);
      placeholderIdx++;
    }
  }
  const insertText = dims.length === 0
    ? cubeName + "'"
    : cubeName + "', " + parts.join(', ');
  return { insertText, isSnippet: dims.length > 0 && placeholderIdx > 1 };
}

/**
 * Build the insert text for an ExecuteProcess-style completion.
 *
 * - Zero-param process → `Name'`, no snippet.
 * - With params → `Name', 'p1', ${1:value}, 'p2', '${2:value}'` with
 *   string params quoted, numerics bare. Always a snippet.
 */
export function buildProcessInsertText(
  procName: string,
  params: ReadonlyArray<ProcessParamInfo>,
): { insertText: string; isSnippet: boolean } {
  let insertText = procName + "'";
  if (params.length === 0) { return { insertText, isSnippet: false }; }
  const parts: string[] = [];
  params.forEach((p, i) => {
    const placeholder = `\${${i + 1}:value}`;
    const valExpr = p.type === 'Numeric' ? placeholder : `'${placeholder}'`;
    parts.push(`'${p.name}', ${valExpr}`);
  });
  insertText += ', ' + parts.join(', ');
  return { insertText, isSnippet: true };
}
