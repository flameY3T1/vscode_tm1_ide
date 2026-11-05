/**
 * Stateless TI/Rules line-text helper, shared across the rules linter,
 * TI server linter and the reference-index/resolver modules.
 *
 * vscode-free, no side effects — safe to import from any layer.
 */

/**
 * Replaces quoted string literals with spaces and strips a trailing comment.
 *
 * Order matters: strings are neutralized FIRST so that a `#` inside a string
 * literal is treated as string content, not as a comment start.
 */
export function neutralizeLine(line: string): string {
  return line
    .replace(/'[^']*'/g, s => ' '.repeat(s.length))
    .replace(/#.*$/, '');
}
