import type * as monacoType from 'monaco-editor';

interface NamedThing { Name: string }

/**
 * Computes inline decorations that color identifiers matching parameter or
 * DS-variable names. Monarch tokens are static; these decorations carry the
 * dynamic coloring that depends on the process's current Parameters/Variables.
 */
export function buildIdentifierDecorations(
  monaco: typeof monacoType,
  model: monacoType.editor.ITextModel,
  parameters: NamedThing[],
  dsVariables: NamedThing[],
): monacoType.editor.IModelDeltaDecoration[] {
  const paramSet = new Set(parameters.map(p => p.Name.toLowerCase()).filter(n => n.length > 0));
  const dsVarSet = new Set(dsVariables.map(v => v.Name.toLowerCase()).filter(n => n.length > 0));
  if (paramSet.size === 0 && dsVarSet.size === 0) { return []; }

  const decorations: monacoType.editor.IModelDeltaDecoration[] = [];
  const lineCount = model.getLineCount();
  const identRe = /[A-Za-z_][A-Za-z0-9_]*/g;

  for (let line = 1; line <= lineCount; line++) {
    const content = model.getLineContent(line);
    const stripped = stripStringsAndComments(content);
    identRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(stripped)) !== null) {
      const word = m[0];
      const lower = word.toLowerCase();
      let className: string | null = null;
      if (paramSet.has(lower)) { className = 'ti-ident-param'; }
      else if (dsVarSet.has(lower)) { className = 'ti-ident-dsvar'; }
      if (!className) { continue; }
      decorations.push({
        range: new monaco.Range(line, m.index + 1, line, m.index + word.length + 1),
        options: { inlineClassName: className },
      });
    }
  }
  return decorations;
}

/** Replaces string-literal bodies and comments with spaces so the identifier
 *  regex doesn't pick up things that are actually strings or comments. Keeps
 *  column positions intact. */
function stripStringsAndComments(line: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < line.length) {
    const ch = line[i];
    if (inStr) {
      out += ' ';
      if (ch === "'") {
        // Handle doubled single quote as escape
        if (line[i + 1] === "'") { out += ' '; i += 2; continue; }
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '#') {
      out += ' '.repeat(line.length - i);
      break;
    }
    if (ch === "'") {
      inStr = true;
      out += ' ';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
