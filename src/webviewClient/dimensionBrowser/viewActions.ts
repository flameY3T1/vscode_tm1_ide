/** Intents that replace the base or push onto the stack: toggle, base, context menu, sort, level, MDX, alias. */

import { initialView, toggleDrill, pushIntent, mdxBase, expandFully, setSortIntent, setLevelFilter, currentSort, type BaseKind } from './intents';
import { planCtxAction, type CtxAction } from './ctxIntents';
import { drillMdx, toLevelMdx } from './viewMdx';
import { clearMarks, markedNames } from './viewMarks';
import { flashBanner } from './banner';
import { showActiveAlias } from './viewControls';
import { getL10n, fmt } from '../_shared/l10n';
import { vr } from './viewRun';
import { fetchRows } from './viewFetch';
import { rowHeight } from './viewViewport';
import { paintMarkCount } from './viewStats';
import { postFromView } from './viewQuery';
import { setSelectionAsBase } from './viewLayers';

const L = getL10n();

/**
 * Back to the starting base, with an empty stack - "Show all".
 *
 * Not `setBase('tree')`: that did set the base, but would leave a
 * preview standing. "Everything back" means everything.
 */
export function resetView(): void {
  if (!vr.run) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = initialView('tree');
  freshAnswer();
  fetchRows();
}

/** A click on the triangle: flip the intent, fetch again. */
export function toggleAt(member: string, open?: boolean): void {
  if (!vr.run) { return; }
  // The direction comes from the SERVER, not from the base: `offen` is the
  // collapse state that the response reported for this occurrence
  // (`DisplayInfo` bit). On `.Members` everything is open - the triangle collapses
  // it; on `TM1SUBSETALL` everything is closed - it expands
  // (`DRILLDOWNMEMBER`, measured live 2026-08-22). Without a value, "open" applies,
  // the old meaning.
  const isOpen = open ?? true;
  vr.run.previousView = vr.run.view;
  vr.run.view = toggleDrill(vr.run.view, member, isOpen);
  // Only a COLLAPSE can be without effect, and only on a COMPLETE
  // window is that decidable: if anything stands behind it (`hasMore`), the
  // block could lie outside and the message would be a lie.
  vr.run.toggleAttempt = isOpen && !vr.hasMore
    ? { member, rowsBefore: vr.rows.map((r) => r.name) }
    : null;
  // Where does the clicked row currently stand on the screen? After the response it should
  // stand there again - collapsed as well as expanded.
  const idx = vr.rows.findIndex((r) => r.name === member);
  if (idx >= 0) {
    const c = document.getElementById('table-container') as unknown as { scrollTop: number } | null;
    vr.run.holdPosition = { member, offsetPx: idx * rowHeight() - (c ? c.scrollTop : 0) };
  } else {
    vr.run.holdPosition = null;
  }
  fetchRows();
}

/**
 * Switch the base.
 *
 * The stack drops in the process, and that is not a convenience: a
 * collapse intent on a FLAT set is moot, and a filter that was chosen
 * against the tree promises something different on the set
 * (spec part I, "The base is a control"). The marks drop
 * with it - they were chosen on a set that no longer exists.
 */
export function setBase(kind: BaseKind): void {
  if (!vr.run) { flashBanner(L.vwNoDimBase ?? ''); return; }
  // Reset also happens with the SAME base (flameY3T1, 2026-08-22: "when I
  // click tree or all, everything should always be reset"). The
  // button is thereby also the way back to the start - before, a click on
  // the base already in place was without effect, and whoever wanted to get rid of the stack
  // had to go via the other base and back again.
  vr.run.previousView = vr.run.view;
  vr.run.view = initialView(kind);
  freshAnswer();
  fetchRows();
}

/**
 * Execute a context menu entry.
 *
 * The meaning is in `ctxIntents.ts`, not here - this function only executes
 * what was decided there. `direct` touches the menu itself
 * (clipboard).
 *
 * Return: `true` if the new path has handled the action. `false` means
 * "not my business" - the caller then decides itself.
 */
export function applyCtxAction(action: CtxAction, member: string): boolean {
  if (!vr.run) { flashBanner(L.vwNoDim ?? ''); return true; }
  const plan = planCtxAction(action, { member, marked: markedNames() });
  switch (plan.kind) {
    case 'intent':
      vr.run.previousView = vr.run.view;
      vr.run.view = pushIntent(vr.run.view, plan.intent);
      clearMarks();
      paintMarkCount();
      fetchRows();
      return true;
    case 'base':
      setBase(plan.base);
      return true;
    case 'freeze':
      setSelectionAsBase(plan.names);
      return true;
    case 'reset':
      vr.run.previousView = vr.run.view;
      vr.run.view = { base: vr.run.view.base, intents: [] };
      clearMarks();
      paintMarkCount();
      fetchRows();
      return true;
    case 'direct':
      return false;
    // Inserting needs the clipboard, and reading it is
    // asynchronous. `viewCtx` fetches it and calls `insertNamesAt` - here only
    // half an operation would be possible.
    case 'insert':
      return false;
    // "All parents": a LAYER, not a base - the element stays and
    // the set below it as well. The occurrence path comes from the clicked
    // row; without it `TM1ROLLUP` would silently hit nothing.
    // Fetch the parent list; `onAncestorsForPicks` fills the submenu.
    // No `fetchRows()`: it does not change the set, it only asks.
    case 'parents':
      postFromView({
        type: 'drillAncestors', dimName: vr.run.dim, hierName: vr.run.hier,
        element: member, recursive: false,
      });
      return true;
    case 'rollup': {
      const row = vr.rows.find((r) => r.name === member);
      if (!row) { flashBanner(L.vwNothingMarked ?? ''); return true; }
      vr.run.previousView = vr.run.view;
      vr.run.preview = null;
      vr.run.view = pushIntent(vr.run.view, {
        kind: 'rollup', member, ancestors: row.ancestors.map((a) => a.name),
      });
      fetchRows();
      return true;
    }
    // The number is fetched by `viewCtx` (modal), which calls `setToLevelBase` - here
    // only half an operation would be possible, as with inserting.
    case 'to-level':
      return false;
    // "Expand completely": a collapse layer, not a base. The rest of the
    // view therefore stays (decision by flameY3T1, 2026-08-26). The
    // marks stay as well - nothing disappears that they could
    // point to.
    case 'expand-fully':
      vr.run.previousView = vr.run.view;
      vr.run.preview = null;
      vr.run.view = expandFully(vr.run.view, plan.member);
      fetchRows();
      return true;
    case 'drill': {
      // Every drill action is a complete ANSWER, hence a base -
      // the same form as "only this element" and "collapse all". With a
      // label, so that the trail says what is there, instead of just "MDX".
      const LABELS = {
        leaves: 'vwBaseLeaves', 'elem-plus-leaves': 'vwBaseElemLeaves',
      } as const;
      vr.run.previousView = vr.run.view;
      vr.run.preview = null;
      vr.run.view = mdxBase(
        drillMdx(plan.action, plan.member, vr.run.dim, vr.run.hier),
        fmt(L, LABELS[plan.action], plan.member),
      );
      freshAnswer();
      fetchRows();
      return true;
    }
    default: {
      const unreachable: never = plan;
      throw new Error(`unbekannter Plan: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Set the sorting - the click path of the select field.
 *
 * Immediately and without confirmation: a selection is a single act. It orders
 * what is to be SEEN, so it carries the display alias along (the same rule as the
 * search). Not with the tree order - the alias says nothing about the tree position.
 */
export function setSort(mode: 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc' | 'none'): void {
  if (!vr.run) { return; }
  const m = mode === 'none' ? null : mode;
  if (currentSort(vr.run.view) === m) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.view = setSortIntent(vr.run.view, m, vr.run.alias || undefined);
  fetchRows();
}

/**
 * Toggle a level - `null` clears them all.
 *
 * No comparison for equality any more: choosing the same level again IS
 * the operation that takes it away again.
 */
export function setLevel(level: number | null): void {
  if (!vr.run) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.view = setLevelFilter(vr.run.view, level);
  fetchRows();
}

/**
 * Make a hand-written expression the base - "Execute" in the
 * MDX popup.
 *
 * The stack drops in the process (`mdxBase`): the layers applied to the old
 * answer. An empty expression is not a base.
 *
 * The SAME expression resets as well - the same decision as with
 * `setBase` (flameY3T1, 2026-08-22: "when I click tree or all, everything should
 * always be reset"). Here it is not a matter of taste: "Refresh"
 * behind the select field reloads the subset, and its base is the same
 * expression as before - the filters just lie on top of it. A guard "same
 * expression does not fetch twice" would make the button ineffective.
 *
 * Whether the expression is valid is decided by the SERVER. If it is not,
 * `viewRows` comes with `ok:false`, and `onViewRows` rolls back to the state before
 * and names the error - the same path as with any other intent.
 */
export function setMdxBase(expr: string): void {
  const e = expr.trim();
  if (!vr.run || !e) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = mdxBase(e);
  freshAnswer();
  fetchRows();
}

/**
 * What every new BASE brings with it: the standing rows and the
 * marks belonged to the old answer.
 *
 * Without this, marks would remain on names that the new set does not
 * know at all, and the next keep/remove layer would build an `INTERSECT`
 * against them - empty or unchanged, without explanation.
 */
export function freshAnswer(): void {
  clearMarks();
  vr.rows = [];
  vr.hasMore = false;
  paintMarkCount();
}

/**
 * "Expand to level": the element and everything below it UP TO the target level
 * become the new base - the intermediate levels stay.
 *
 * `elementLevel` is the level of the clicked row. From it the distance
 * downward is derived; the expression only knows distances (`DESCENDANTS`), the display
 * and the menu on the other hand speak of levels - TM1's element level is the height
 * above the leaves, so an element of level 3 reaches three steps deep.
 */
export function setToLevelBase(member: string, level: number, elementLevel: number): void {
  if (!vr.run || !member || !Number.isFinite(level) || !Number.isFinite(elementLevel)) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = mdxBase(
    toLevelMdx(member, elementLevel - level, vr.run.dim, vr.run.hier),
    fmt(L, 'vwBaseToLevel', member, level),
  );
  freshAnswer();
  fetchRows();
}

/**
 * Toggle the display alias.
 *
 * Fetches anew, because the label comes from the server (`parseSetAnswer` reads the
 * chosen attribute value). The same alias twice does not fetch twice.
 *
 * The stack stays untouched: an already confirmed search keeps the alias
 * against which it was declared. Reinterpreting it afterwards would mean changing
 * an intent of the user without them having touched it.
 */
export function setAlias(attr: string): void {
  if (!vr.run || vr.run.alias === attr) { return; }
  vr.run.alias = attr;
  showActiveAlias(attr);
  fetchRows();
}
