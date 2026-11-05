export {};

import type { Intent, BaseKind } from './intents';

/**
 * The ONE place that turns a context menu entry into an intent.
 *
 * Why at all: the old menu handlers (`ctxActions.ts`) do not merely read
 * state, they WRITE it — delete list, drill token, `compose.expanded`.
 * The new load path reads none of that, it draws from the expression. A
 * handler that was merely pointed at the new rows would therefore write into
 * a state nobody displays any more — two truths side by side, exactly the
 * sickness the rebuild set out to cure (decision flameY3T1, 2026-08-22:
 * "shouldn't we adapt that to our new way").
 *
 * This file is vscode-free and DOM-free — it only decides WHAT an entry
 * means. Who executes it and who draws it is stated elsewhere.
 */

/** The entries of the menu, without the `ctx-` prefix of their markup ids. */
export type CtxAction =
  | 'only-this' | 'clear-all' | 'collapse-all' | 'expand-all'
  | 'show-parents' | 'show-all-parents' | 'leaves' | 'elem-plus-leaves'
  | 'insert-above' | 'insert-below' | 'expand-to-level'
  | 'copy-name';

export type CtxPlan =
  /** A PAfE drill action — it becomes the new base. */
  | { kind: 'drill'; action: 'leaves' | 'elem-plus-leaves'; member: string }
  /**
   * Expand the element's subtree completely — as a LAYER, the rest of the view
   * stays in place (decision flameY3T1, 2026-08-26: "if others are supposed to
   * stand next to it, they should stay there"). Hence no `drill`: that would
   * be a new base and leave only the subtree.
   */
  | { kind: 'expand-fully'; member: string }
  /** Put the parents above the element, the element stays (`TM1ROLLUP`). */
  | { kind: 'rollup' }
  /** Fetch the parent list and offer it for choice in the submenu. */
  | { kind: 'parents' }
  /** Ask for a level and restrict the DESCENDANTS to it. */
  | { kind: 'to-level' }
  /** Insert names from the clipboard at this position. */
  | { kind: 'insert'; below: boolean }
  /** One layer onto the stack. */
  | { kind: 'intent'; intent: Intent }
  /** A base change — resets the stack. */
  | { kind: 'base'; base: BaseKind }
  /**
   * The SELECTION becomes the new base: `{[d].[h].[a],[d].[h].[b]}`.
   *
   * Decision flameY3T1, 2026-08-22: "when I explicitly select one or more
   * elements, that should begin as {} and be continued from there. is simpler
   * and more intuitive."
   *
   * The alternative would have been a layer `INTERSECT(…, {…}, ALL)`. Measured
   * live on `aa`, where `a` hangs under two parents
   * (dimOnlyThisFormProbe.js): the layer yields `a | a`
   * (every OCCURRENCE), the set literal `a` (every ELEMENT once) and takes
   * the order in which the names stand. The price is paid deliberately:
   * shorter expression, no occurrence twice — in return the selection replaces
   * the stack instead of being revocable via `×`.
   */
  | { kind: 'freeze'; names: string[] }
  /** Empty the stack, keep the base. */
  | { kind: 'reset' }
  /**
   * NO set operation. Alias is a display property, "copy names" reaches for
   * the clipboard — pressing both through the intent stack would be
   * pedantry, not architecture.
   */
  | { kind: 'direct'; action: CtxAction }
  /** Not yet expressed as an intent — the caller says so instead of staying silent. */

export interface CtxContext {
  /** The element of the clicked row. */
  member: string;
  /** The currently marked names — "only this" means them, if there are any. */
  marked: readonly string[];
}

export function planCtxAction(action: CtxAction, ctx: CtxContext): CtxPlan {
  switch (action) {
    // A marking beats the clicked row: whoever marks six rows and then picks
    // "only these" means the six. Exactly the rule of the old path
    // (`ctxActions.ts#onlyThisCount`).
    case 'only-this':
      return { kind: 'freeze', names: ctx.marked.length ? ctx.marked.slice() : [ctx.member] };
    case 'clear-all':
      return { kind: 'reset' };
    // "Collapse all" IS the root set — not a stack of N collapses, but a
    // different base (`FILTER(Members, Parent.Name = "")`).
    case 'collapse-all':
      return { kind: 'base', base: 'roots' };
    // "Copy names" only touches the clipboard — no set operation, hence no
    // layer. The old handler may keep doing that.
    case 'copy-name':
      return { kind: 'direct', action };
    // Inserting at an exact position needs the CLIPBOARD — a read that is
    // asynchronous. The caller fetches it and calls `insertNamesAt`; all that
    // is stated here is that the new display does it itself (and not the old
    // handler, whose target would be `state._manualRows`).
    case 'insert-above':
    case 'insert-below':
      return { kind: 'insert', below: action === 'insert-below' };
    // Alias is not a set operation either, but in the new path an alias
    // change needs a new fetch (the caption comes from the server).
    // The old handler would write `state._displayAlias` and drag the old
    // drawing path back in — so report it first, until it is wired up.
    // The PAfE drill actions. Each is a complete ANSWER, hence
    // a base — the same form as "only this element" and "collapse
    // all". The expressions are in `viewMdx.ts#drillMdx`, measured.
    case 'leaves':
    case 'elem-plus-leaves':
      return { kind: 'drill', action, member: ctx.member };
    // "Expand completely" does NOT belong here, although it stands in the same
    // menu block: it does not answer the question "what should be shown", but
    // expands a row of the existing answer.
    case 'expand-all':
      return { kind: 'expand-fully', member: ctx.member };
    // "All parents": the element STAYS and gets its parents above it
    // (decision flameY3T1, 2026-08-23). That is `TM1ROLLUP` — 1 ms,
    // against 3.2 s for `FILTER(SUBSETALL, CHILDREN ∩ x)`, and that one left
    // the element out.
    case 'show-all-parents':
      return { kind: 'rollup' };
    // NOT expressible (as of 2026-08-23):
    //  • `show-all-parents` — an ancestor chain needs `DESCENDANTS`
    //    INSIDE a `FILTER`, and that SILENTLY yields 0 live.
    //  • `alias` — has a selection field of its own; a second way there would
    //    be a second state.
    //  • `expand-to-level` — the level choice is already in the bar
    //    (decision flameY3T1, 2026-08-23).
    // `show-parents` is a SUBMENU: it lists the parents and lets a SPECIFIC
    // one be chosen. The list comes from the server (`drillAncestors`) — the
    // row carries only ITS occurrence path, i.e. the one parent under which
    // it currently stands.
    case 'show-parents':
      return { kind: 'parents' };
    // "Expand to level" needs a NUMBER from the user — the caller fetches it
    // (modal), as it fetches the clipboard for "insert".
    case 'expand-to-level':
      return { kind: 'to-level' };
    default: {
      const unreachable: never = action;
      throw new Error(`unbekannte Kontextaktion: ${JSON.stringify(unreachable)}`);
    }
  }
}
