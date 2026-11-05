/**
 * Builds the entries of the selection field.
 *
 * The current cell value can lie outside the list: measured, a value that was
 * written BEFORE the picklist was set stays in place. It is carried as a marked
 * extra entry so that merely opening the editor does not silently change the
 * value.
 */

export interface PicklistOption { value: string; label: string; foreign: boolean }

/**
 * `foreignLabel` builds the hint text for the foreign value. This file is a
 * `*Pure` module (`pure-no-vscode`, see docs/architecture/import-rules.md) and must not import
 * `vscode.l10n` - the caller (`editor.ts`) passes in the already translated
 * formatting function.
 */
export function buildPicklistOptions(
  values: string[], current: string, foreignLabel: (value: string) => string,
): PicklistOption[] {
  const list: PicklistOption[] = values.map((v) => ({ value: v, label: v, foreign: false }));
  const cur = String(current ?? '').trim();
  if (cur !== '' && !values.includes(cur)) {
    list.unshift({ value: cur, label: foreignLabel(cur), foreign: true });
  }
  return list;
}
