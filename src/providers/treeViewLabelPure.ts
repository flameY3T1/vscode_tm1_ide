/**
 * Pure tree view label helpers (no vscode imports).
 */

/**
 * Appends {} suffix to label if view is MDX, else returns label unchanged.
 * @param label View name
 * @param isMdx True if MDX view
 * @returns Label with {} suffix if MDX, else raw label
 */
export function mdxViewLabel(label: string, isMdx: boolean): string {
  return isMdx ? `${label} {}` : label;
}
