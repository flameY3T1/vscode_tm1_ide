/**
 * The active line in the process editor is highlighted in the color of the USER's
 * theme. Monaco's bundled `vs`/`vs-dark` only paints a pale
 * border and does not know the VS Code theme colors — so the rule has to live in
 * the webview CSS, where the `--vscode-*` variables are live (they change
 * by themselves when the theme changes, without the Monaco theme having to be
 * redefined).
 *
 * Source scan instead of a DOM test: the webview CSS is a template literal, there is
 * no jsdom in this project, and what matters here is precisely THAT the rule
 * with the theme variable is in the shipped CSS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EDITORS: Array<[label: string, relPath: string[]]> = [
  ['Prozess-Editor', ['commands', 'processEditor', 'processEditorMonacoWebview.ts']],
  ['Regel-Editor', ['commands', 'rule', 'ruleEditorMonacoWebview.ts']],
];

describe.each(EDITORS)('%s — active line in theme color', (_label, relPath) => {
  const SRC = readFileSync(join(__dirname, '..', ...relPath), 'utf8');

  it('highlights `.current-line` with the user\'s theme color', () => {
    const rule = SRC.split('\n').find((l) => l.includes('.view-overlays .current-line'));
    expect(rule, 'CSS-Regel für die aktive Zeile fehlt').toBeTruthy();
    expect(rule).toContain('--vscode-editor-lineHighlightBackground');
    // Many themes do not set `lineHighlightBackground` at all — without a fallback
    // the line would stay unmarked for exactly those users.
    expect(rule).toContain('--vscode-editor-rangeHighlightBackground');
    // Monaco writes the same rule from its theme stylesheet.
    expect(rule).toContain('!important');
  });

  it('lets the border follow the theme instead of Monaco\'s default box', () => {
    const border = SRC.split('\n').find((l) => l.includes('--vscode-editor-lineHighlightBorder'));
    expect(border, 'Rahmenfarbe der aktiven Zeile fehlt').toBeTruthy();
    expect(border).toContain('!important');
  });
});
