/**
 * Where the MDX expression comes from that the bar and the popup show.
 *
 * A module of its own, because `domMdxModal.ts` would otherwise have to import `viewPath.ts`
 * and thereby pull the whole draw path into the old path. Only the switch
 * lives here - and it lives in ONE place, so that bar and popup do not drift
 * apart again.
 */
import { currentMdx, setMdxBase } from './viewPath';

/**
 * The expression for the popup.
 *
 * In the new path always `currentMdx()` - the same source the bar
 * writes from. For a long time the popup read `effectiveMdx()` from the old path (drill >
 * subset expression > list) and thereby showed a state that the new path had never
 * explained.
 *
 * NO fallback to a foreign state when the path has nothing to say
 * at the moment: a foreign state shown would be worse than an empty field, because
 * it could be copied and saved.
 */
export function mdxForPopup(): string {
  return currentMdx() ?? '';
}

/**
 * Adopt an expression edited in the popup.
 *
 * In the new path it becomes the BASE (`viewPath#setMdxBase`) - it replaces the
 * answer on which layers are then laid in the normal way. Formerly the button wrote
 * `state._subsetExpression` and posted `runSubsetMdx`; that let the OLD renderer
 * draw over the new one, which is why it was blocked here for a while.
 *
 * Returns `true` when it was adopted - then the caller must NOT also take the
 * old path.
 */
export function runEditedMdx(expr: string): boolean {
  setMdxBase(expr);
  return true;
}
