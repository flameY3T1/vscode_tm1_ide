/**
 * What the new load path returns when the browser runs as a SELECTION.
 *
 * The Cube Viewer opens it that way (filter chip of an axis). The new path kept
 * nothing for it: the footer counted `state._visibleNames`, "Apply"
 * sent `_collectVisibleSelection()` - both from the old state. The
 * window opened, showed rows and returned nothing on confirm.
 *
 * A module of its own like `mdxSource.ts` and `subsetSource.ts`, for the same reason:
 * `dom.ts`/`footer.ts` must not pull the whole draw path into the old path,
 * and the switch belongs in one place.
 */
import {
  currentRows, rowsComplete, currentTotal, currentMdx, viewIsPristine,
} from './viewPath';
import { markedNames, markCount } from './viewMarks';
import { state, isAllowed } from './state';
import { flashBanner } from './banner';
import { getL10n } from '../_shared/l10n';
import type { SelectionPayload } from './protocol';

const L = getL10n();

/**
 * The answer to "Apply".
 *
 * The order of the cases is that of the old path, for the same reasons:
 *
 * 1. A MARK is a manual selection - exactly the clicked rows. The name list is
 *    right for that, even if the caller tolerates expressions.
 * 2. An untouched view IS the whole dimension. `{kind:'all'}` instead of a
 *    name list: the recipient puts the dimension on the axis from it, instead of
 *    the loaded 5000 names.
 * 3. If the caller tolerates expressions, the expression is the intent - filtering,
 *    sorting, collapsing are stated there as MDX, not as 26 names.
 * 4. Otherwise the visible names.
 *
 * `null` means REJECTED (with a message): the window is incomplete and the
 * caller does not understand an expression. The name list would then be a silent
 * truncation - the same danger as with static saving.
 */
export function selectionFromView(): SelectionPayload | null {
  if (markCount() > 0) {
    const typeOf: Record<string, 'N' | 'C' | 'S'> = {};
    for (const r of currentRows()) { typeOf[r.name] = r.type; }
    // A mark on a row outside the window no longer knows a type.
    // Letting it through is more correct than silently losing it from
    // lack of knowledge - the user clicked it.
    return {
      kind: 'elements',
      names: markedNames().filter((n) => {
        const t = typeOf[n];
        return !t || isAllowed(t);
      }),
    };
  }

  if (viewIsPristine()) { return { kind: 'all' }; }

  if (state._acceptsExpression) {
    const mdx = currentMdx();
    if (mdx) { return { kind: 'expression', expression: mdx }; }
  }

  if (!rowsComplete()) {
    flashBanner(L.vwSelectionWindowIncomplete ?? '');
    return null;
  }
  return {
    kind: 'elements',
    names: currentRows().filter((r) => isAllowed(r.type)).map((r) => r.name),
  };
}

/** Visible rows and total count for the footer. */
export function selectionCountFromView(): { visible: number; total: number } {
  return { visible: currentRows().length, total: currentTotal() };
}
