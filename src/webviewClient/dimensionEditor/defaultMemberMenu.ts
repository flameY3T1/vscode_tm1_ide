// src/webviewClient/dimensionEditor/defaultMemberMenu.ts
//
// Menu logic for the default member. A module of its own, because the only
// real branches live here and can thus be tested without a DOM.
import type { ContextMenuItem } from './contextMenu';
// Do NOT import from `tm1Rest` — `webview-no-tm1rest` forbids that even for
// type-only imports. The shared type therefore lives in `dimensionEditor/model`.
import type { DefaultMemberState } from '../../dimensionEditor/model';

export {};

export interface DefaultMemberMenuLabels {
  readonly set: string;
  readonly reset: string;
  readonly blockedDirty: string;
  readonly blockedDraft: string;
}

export interface DefaultMemberMenuArgs {
  /** The element that was clicked. */
  readonly element: string;
  /** The hierarchy currently displayed. */
  readonly hier: string;
  /** The draft has unsaved changes. */
  readonly dirty: boolean;
  /** The element already exists on the server (not only in the draft). */
  readonly onServer: boolean;
  /** Last state read; `undefined` as long as nothing has been loaded. */
  readonly state: DefaultMemberState | undefined;
  readonly labels: DefaultMemberMenuLabels;
  /** `null` = reset. */
  readonly onSet: (element: string | null) => void;
}

const eq = (a: string | null | undefined, b: string): boolean =>
  (a ?? '').toLowerCase() === b.toLowerCase();

/**
 * One entry, never two: either set or reset.
 *
 * Reset appears only when the element is the EXPLICITLY set one. If it is
 * merely the default derived by TM1, "set" remains correct — the click
 * turns a derivation into a setting, and that is a real difference.
 *
 * Locking is done against the draft state, because the write goes to the SERVER:
 * setting a default member to an element that only the next commit
 * creates would be accepted by TM1 without a word and silently fizzle out.
 */
export function buildDefaultMemberItems(args: DefaultMemberMenuArgs): ContextMenuItem[] {
  const isExplicit = eq(args.state?.explicit, args.element);
  const label = isExplicit ? args.labels.reset : args.labels.set;

  if (!args.onServer) {
    return [{ label, disabled: true, title: args.labels.blockedDraft }];
  }
  if (args.dirty) {
    return [{ label, disabled: true, title: args.labels.blockedDirty }];
  }
  return [{ label, onClick: () => args.onSet(isExplicit ? null : args.element) }];
}
