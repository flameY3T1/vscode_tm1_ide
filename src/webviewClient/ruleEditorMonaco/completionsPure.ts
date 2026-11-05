/**
 * Pure helpers for the rule-editor Monaco completions / hover.
 *
 * Extracted from `completions.ts` (Hebel 17 — Iter 7). No Monaco, no DOM,
 * no module state.
 *
 * S3: the generic signature renderers (buildSignatureLabel /
 * buildSnippetInsertText / buildMarkdownDoc) + their types now live in
 * `../_shared/tiSignatureRender` (shared with the process editor) and are
 * re-exported here so existing `./completionsPure` importers are unchanged.
 * The rule-only helpers (getFuncArgContext, buildCubeInsertText) stay here.
 */

export {};

export {
  buildSignatureLabel,
  buildSnippetInsertText,
  buildMarkdownDoc,
  markdownDocLabelsFromL10n,
} from '../_shared/tiSignatureRender';

export interface FuncArgContext {
  funcName: string;
  argIdx: number;
  args: string[];
}

/**
 * Parse the open-string-arg context at the end of `before` (the substring
 * from the start of the line/file up to the cursor). Returns null when the
 * cursor is NOT inside an open string argument of a function call.
 *
 * Returns:
 *  - `funcName`: lowercased function name being called
 *  - `argIdx`:   0-based index of the currently-typed argument
 *  - `args`:     completed string arguments collected so far
 */
export function getFuncArgContext(before: string): FuncArgContext | null {
  let qCount = 0;
  for (let k = 0; k < before.length; k++) { if (before[k] === "'") { qCount++; } }
  if (qCount % 2 === 0) { return null; }
  const lastQ = before.lastIndexOf("'");

  let depth = 0;
  let openPos = -1;
  for (let i = lastQ - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ')') { depth++; }
    else if (ch === '(') {
      if (depth === 0) { openPos = i; break; }
      depth--;
    }
  }
  if (openPos < 0) { return null; }
  const fnMatch = /([A-Za-z]\w*)$/.exec(before.slice(0, openPos));
  if (!fnMatch) { return null; }

  let argIdx = 0, d = 0, inS = false;
  const args: string[] = [];
  let cur = '';
  for (let j = openPos + 1; j < lastQ; j++) {
    const c = before[j];
    if (c === "'" && !inS) { inS = true; cur = ''; }
    else if (c === "'" && inS) { inS = false; args.push(cur); cur = ''; }
    else if (inS) { cur += c; }
    else if (c === '(') { d++; }
    else if (c === ')') { d--; }
    else if (c === ',' && d === 0) { argIdx++; }
  }
  return { funcName: fnMatch[1].toLowerCase(), argIdx, args };
}

/**
 * Build the insert-text portion for a DB() cube-with-dims completion.
 * Each dim resolves to either a `!Dim` reference (when the dim is in the
 * rule's enclosing cube) or a `'${N:Dim}'` placeholder otherwise.
 *
 * Returns:
 *  - `insertText`: the full text after the opening cube-name quote
 *  - `isSnippet`:  true when at least one placeholder was emitted
 *
 * Zero-dim cube returns `cubeName + "'"` with no snippet markers.
 */
export function buildCubeInsertText(
  cubeName: string,
  dims: ReadonlyArray<string>,
  ruleDimsLower: ReadonlySet<string>,
): { insertText: string; isSnippet: boolean } {
  let placeholderIdx = 1;
  const parts: string[] = [];
  for (const dim of dims) {
    if (ruleDimsLower.has(dim.toLowerCase())) {
      parts.push('!' + dim);
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
