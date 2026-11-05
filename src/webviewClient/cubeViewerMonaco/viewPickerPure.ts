/**
 * DOM-free parts of the view picker - `viewPicker.ts` cannot be executed
 * without jsdom, these can.
 */

import { DYNAMIC_SUBSET_MARK } from '../../utils/dynamicSubsetMark';

/** `isPrivate` is optional because the host payload omits it for public views. */
export interface PickerView { name: string; isPrivate?: boolean; isMdx?: boolean }

/**
 * Label of a dropdown entry: `Name {}` for an MDX view, otherwise the bare
 * name.
 *
 * An `<option>` renders text only - no markup, no icon - so the marking has to
 * be part of the label. The same character as on the dynamic subset
 * (`DYNAMIC_SUBSET_MARK`), because it carries the same statement: the content
 * comes from an MDX expression, not from stored axes or a stored element list.
 */
export function viewOptionLabel(name: string, isMdx: boolean): string {
  return isMdx ? name + '  ' + DYNAMIC_SUBSET_MARK : name;
}

/**
 * The option value of a view. Public and private can carry the same NAME, so
 * the value has to carry the origin along - `populateViewSelect` and
 * `showOpenedView` must form the same value, otherwise the preselection does
 * not find the option that was just inserted again.
 */
export function viewOptionValue(name: string, isPrivate: boolean): string {
  return (isPrivate ? 'priv:' : 'pub:') + name;
}

/**
 * The reverse direction of `viewOptionValue`: recover the selected view from
 * the dropdown value. `null` for the placeholder "Own selection" and anything
 * unexpected.
 *
 * This is needed because the dropdown is the only place that retains the
 * selected view across a pivot: every pivot dissolves the binding in the state
 * (`state.existingViewName = null`), but the mark in the dropdown stays in
 * place - and exactly then "Reload view" should lead back to it.
 */
export function parseViewOptionValue(value: string): { name: string; isPrivate: boolean } | null {
  if (value.indexOf('priv:') === 0) { return { name: value.substring(5), isPrivate: true }; }
  if (value.indexOf('pub:') === 0) { return { name: value.substring(4), isPrivate: false }; }
  return null;
}

/**
 * Public before private, by name within the group.
 *
 * The server delivers all NativeViews first, then all MDX views (measured live
 * 11.8 on `Cube A`: 38 + 44 = 82 views). Unsorted, the whole MDX block thus
 * sits below 38 entries - in the opened dropdown it looks as if there were no
 * MDX views.
 *
 * `localeCompare` with `sensitivity: 'base'`, not a code-unit comparison: this
 * is a DISPLAY order for humans, and it should sort `Ärger` in under `A`.
 * (Not to be confused with `TM1SORT`, which compares code units - there
 * `localeCompare` would fail, see the collation note on the Dimension Browser.)
 */
export function sortViewsForPicker<T extends PickerView>(views: readonly T[]): T[] {
  return views.slice().sort((a, b) => {
    const pa = a.isPrivate ? 1 : 0, pb = b.isPrivate ? 1 : 0;
    if (pa !== pb) { return pa - pb; }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
