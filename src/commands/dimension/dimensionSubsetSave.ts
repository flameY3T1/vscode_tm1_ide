// src/commands/dimension/dimensionSubsetSave.ts
//
// Subset side of the dimension browser: list the subsets of a hierarchy, read
// one back, and WRITE one — static element list or MDX expression.
//
// S2-8 (review 2026-08-02) moved this out of `dimensionBrowserHandlers.ts`.
// It stays in `commands/` rather than `tm1Rest/` on purpose: the destructive
// path asks the user a question (`vscode.window.showWarningMessage`, modal) and
// every message it produces is a localized `vscode.l10n.t` string. Pushing it
// down would have meant handing a dozen texts through the transport layer for
// no gain — the rule is "no vscode BELOW commands", not "no logic above it".
//
// The two read helpers (`fetchSubsets`, `fetchSubsetElements`) live here for a
// second reason: they answer in the WEBVIEW's shapes (`SubsetRef`), which is
// presentation, not transport.
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { cacheScope } from '../../tm1Rest/transport/session';
import {
  listSubsetInfos, subsetExists,
  createSubset, updateSubset, clearSubsetElements, subsetElementCount,
  listSubsetElementNames, getSubset,
} from '../../tm1Rest/subsetApi';
import type { SubsetRef } from '../../webviewClient/dimensionBrowser/protocol';
import { encodeODataKey } from '../../utils/odataKey';
import { errMsg } from '../../utils/errMsg';

function enc(s: string): string {
  return encodeODataKey(s);
}

function elementBind(dimName: string, hierName: string, n: string): string {
  return `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')/Elements('${enc(n)}')`;
}

/**
 * Ask before turning a DYNAMIC subset into a static element list.
 *
 * The check reads the SERVER's current state on purpose: the webview's cached
 * expression is nulled by every selection edit, so it cannot tell us whether
 * the subset we are about to write over is rule-driven — which is exactly the
 * case where the overwrite destroys MDX the user cannot get back.
 *
 * The read has three outcomes, not two: dynamic, static, and UNKNOWN. Unknown
 * means the server answered 401/404/500/501 to the undeclared Alias projection,
 * or the call never got an answer at all (`.catch` → null). Treating that as
 * "static" is what let an overwrite delete a rule-driven subset without a single
 * question. Unknown throws instead of asking: without a readable state there is
 * no snapshot to restore if the member write fails, so no consent makes the
 * overwrite safe.
 *
 * Returns false when the user dismissed the modal (= do not touch the subset).
 */
/**
 * What should happen to a dynamic subset on the target.
 *
 * `ask` is the single-item case (tree, editor): a confirmation prompt per
 * item is tolerable there. A bulk run decides ONCE beforehand — up to 200
 * modal windows in the middle of a run are no longer a confirmation prompt,
 * they are a blockage, and each one additionally costs its own GET.
 */
export type FlattenChoice = 'ask' | 'all' | 'skip';

export async function confirmFlattenDynamicSubset(
  dimName: string, hierName: string, subsetName: string, isPrivate: boolean,
  elementCount: number, config: Tm1Config,
): Promise<boolean> {
  const current = await getSubset(config, dimName, hierName, subsetName, isPrivate).catch(() => null);
  if (!current || current.ok === false) {
    throw new Error(vscode.l10n.t('Subset "{0}" could not be read.', subsetName));
  }
  if (!(current.Expression ?? '').trim()) { return true; }
  const convert = vscode.l10n.t('Convert');
  const message = vscode.l10n.t(
    '"{0}" has an MDX expression. Saving replaces it with a fixed list of {1} elements.',
    subsetName, elementCount,
  );
  const pick = await vscode.window.showWarningMessage(message, { modal: true }, convert);
  return pick === convert;
}

/** Sentinel returned by a save the user aborted in the flatten warning. */
export const SAVE_CANCELLED = Symbol('save-cancelled');

export async function saveSubset(
  dimName: string,
  hierName: string,
  subsetName: string,
  isPrivate: boolean,
  elementNames: string[],
  overwrite: boolean,
  config: Tm1Config,
  alias: string | null,
  /** Pre-decided in a bulk run; in the single-item case it stays a confirmation prompt. */
  flatten: FlattenChoice = 'ask',
): Promise<string | typeof SAVE_CANCELLED> {
  const exists = await subsetExists(config, dimName, hierName, subsetName, isPrivate);

  if (exists && !overwrite) {
    throw new Error(vscode.l10n.t('Subset "{0}" already exists. Confirm overwriting it in the dialog.', subsetName));
  }

  const elementBinds = elementNames.map(n => elementBind(dimName, hierName, n));

  if (exists) {
    // Refuse to overwrite from a member list whose read never finished. Anything
    // else turns a transport hiccup into permanent data loss, and the save would
    // look completely normal while doing it.
    if (_incompleteReads.has(readKey(config, dimName, hierName, subsetName, isPrivate))) {
      throw new Error(vscode.l10n.t(
        'Subset "{0}" was not read completely (the server aborted the element list). Overwriting it would truncate it — reload the subset first.',
        subsetName,
      ));
    }
    // Warn BEFORE the write — a dynamic subset loses its MDX here. In a bulk
    // run the question is already answered: `all` writes, `skip` leaves the
    // subset as it is. Both without the GET that the confirmation prompt
    // would otherwise make per item.
    if (flatten === 'skip') { return SAVE_CANCELLED; }
    if (flatten === 'ask') {
      const ok = await confirmFlattenDynamicSubset(
        dimName, hierName, subsetName, isPrivate, elementNames.length, config,
      );
      if (!ok) { return SAVE_CANCELLED; }
    }
    // Overwrite in place, in THREE steps. NOT delete-then-create: TM1 refuses to
    // delete a subset a view refers to (`HTTP 400 … subset being used by view`),
    // so the old path failed on exactly the subsets people build views on.
    //
    // The three steps are forced by TM1's own rules (all live-verified on 11.8,
    // 2026-08-02) and none of them may be merged:
    //
    // 1. `Expression: ''` ALONE. It has to go in its own request, because a body
    //    carrying both a member list and an expression is rejected outright:
    //    `HTTP 400 Encountered both a list of Elements and an Expression in
    //    Subset definition`. An empty string counts as "an expression" for that
    //    check — which is what broke saving over an existing subset. Sent
    //    unconditionally: on an already-static subset it is a harmless no-op,
    //    and that saves asking the server what kind of subset this is.
    // 2. Empty the member list. A PATCH on `Elements` APPENDS (see
    //    `clearSubsetElements`), so without this the old members stay and the
    //    new ones pile on top. Step 1 first, not the other way round: clearing
    //    the rule MATERIALISES its result into the stored list, so a clear that
    //    ran earlier would be undone.
    // 3. Write the members (and the alias, which may travel with them).
    //
    // Step 3 can fail after 1 and 2 went through: binding an element that no
    // longer exists answers 404 and leaves the subset EMPTY (live 11.8,
    // 2026-10-27). So read the old content first and put it back on failure.
    const before = await getSubset(config, dimName, hierName, subsetName, isPrivate);
    const beforeMembers = before.ok && !before.Expression
      ? await listSubsetElementNames(config, dimName, hierName, subsetName, isPrivate)
      : undefined;
    // No write without a usable snapshot: step 3 can fail and the undo needs it.
    // A failed read (ok:false) leaves nothing to restore; the bulk path
    // (flatten='all') never read the subset above.
    if (!before.ok) {
      throw new Error(vscode.l10n.t('Subset "{0}" could not be read.', subsetName));
    }
    if (beforeMembers?.complete === false) {
      throw new Error(vscode.l10n.t(
        'Subset "{0}" was not read completely (the server aborted the element list). Overwriting it would truncate it — reload the subset first.',
        subsetName,
      ));
    }
    try {
      await updateSubset(config, dimName, hierName, subsetName, { Expression: '' }, isPrivate,
        vscode.l10n.t('Clear the MDX rule of subset "{0}"', subsetName));
      await clearSubsetElements(config, dimName, hierName, subsetName, isPrivate,
        vscode.l10n.t('Clear the members of subset "{0}"', subsetName));
      await updateSubset(
        config, dimName, hierName, subsetName,
        { 'Elements@odata.bind': elementBinds, ...aliasBody(alias, true) },
        isPrivate, vscode.l10n.t('Overwrite subset "{0}"', subsetName),
      );
    } catch (err) {
      const restored = await restoreSubset(config, dimName, hierName, subsetName, isPrivate, before, beforeMembers);
      if (restored) { throw err; }
      throw new Error(vscode.l10n.t(
        'Overwriting subset "{0}" failed and its previous content could not be restored. The subset is now empty. Cause: {1}',
        subsetName, errMsg(err),
      ));
    }
    await assertMembersReplaced(config, dimName, hierName, subsetName, isPrivate, elementNames.length);
  } else {
    const body = {
      Name: subsetName,
      'Hierarchy@odata.bind': `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`,
      'Elements@odata.bind': elementBinds,
      ...aliasBody(alias),
    };
    await createSubset(config, dimName, hierName, body, isPrivate, vscode.l10n.t('Create subset "{0}"', subsetName));
  }

  const prefix = isPrivate ? vscode.l10n.t('Private subset') : vscode.l10n.t('Subset');
  return exists
    ? vscode.l10n.t('{0} "{1}" overwritten.', prefix, subsetName)
    : vscode.l10n.t('{0} "{1}" saved.', prefix, subsetName);
}

/**
 * The `Alias` fragment of a subset write body.
 *
 * A create leaves the property out entirely when there is no alias; an overwrite
 * writes `''`, because a PATCH keeps every property it does not mention. Both
 * spellings mean the same thing to TM1 and both match what the browser shows:
 * saving while reading raw names gives a subset with no alias, saving under an
 * alias stores that alias. Before this the alias was dropped on every overwrite.
 */
function aliasBody(alias: string | null, clearWhenEmpty = false): { Alias?: string } {
  if (alias) { return { Alias: alias }; }
  return clearWhenEmpty ? { Alias: '' } : {};
}

/**
 * Prove that the overwrite REPLACED the member list rather than appending to it.
 *
 * TM1's PATCH is not uniformly replace-semantics: on chores it appends tasks
 * (live 11.8). A subset that silently ends up holding the old members plus the
 * new ones is damage the user discovers much later, in a report — so the count
 * is read back and a mismatch is reported at once, while it is still obvious
 * which save caused it. `-1` means the count could not be read; that stays
 * silent, since an unreadable probe is not evidence of damage.
 */
/** Best-effort undo of a failed static overwrite; true when the old content is back. */
async function restoreSubset(
  config: Tm1Config, dimName: string, hierName: string, subsetName: string, isPrivate: boolean,
  before: Awaited<ReturnType<typeof getSubset>>, beforeMembers: Awaited<ReturnType<typeof listSubsetElementNames>> | undefined,
): Promise<boolean> {
  try {
    if (before.ok && before.Expression) {
      await updateSubset(config, dimName, hierName, subsetName, { Expression: before.Expression }, isPrivate);
      return true;
    }
    if (!beforeMembers?.complete) { return false; }
    await clearSubsetElements(config, dimName, hierName, subsetName, isPrivate);
    if (beforeMembers.elements.length > 0) {
      await updateSubset(config, dimName, hierName, subsetName, {
        'Elements@odata.bind': beforeMembers.elements.map(n => elementBind(dimName, hierName, n)),
      }, isPrivate);
    }
    return true;
  } catch {
    return false;
  }
}

async function assertMembersReplaced(
  config: Tm1Config, dimName: string, hierName: string, subsetName: string,
  isPrivate: boolean, expected: number,
): Promise<void> {
  const actual = await subsetElementCount(config, dimName, hierName, subsetName, isPrivate);
  // Anything that is not a usable number counts as "could not read", exactly
  // like the -1 the probe returns on failure: a broken probe must never be the
  // reason a save that went through is reported as damage.
  if (!Number.isFinite(actual) || actual < 0 || actual === expected) { return; }
  throw new Error(vscode.l10n.t(
    'Subset "{0}" now holds {1} elements instead of {2} — the server appended to the member list instead of replacing it. Please check the subset.',
    subsetName, actual, expected,
  ));
}

export async function saveExpressionSubset(
  dimName: string, hierName: string, subsetName: string, isPrivate: boolean,
  expression: string, overwrite: boolean, config: Tm1Config, alias: string | null,
): Promise<string> {
  const exists = await subsetExists(config, dimName, hierName, subsetName, isPrivate);
  if (exists && !overwrite) {
    throw new Error(vscode.l10n.t('Subset "{0}" already exists. Confirm overwriting it in the dialog.', subsetName));
  }
  if (exists) {
    // Overwrite in place — same reason as in `saveSubset`: a subset a view uses
    // cannot be deleted, only written over. Elements are deliberately not part
    // of the body, for two reasons: a body carrying BOTH a member list and an
    // expression is rejected (`HTTP 400 Encountered both a list of Elements and
    // an Expression`), and a dynamic subset resolves its members from the
    // expression anyway. A stored list left behind is harmless — turning the
    // subset static later materialises the CURRENT MDX result, not the stale
    // list (live-verified 11.8, 2026-08-02).
    await updateSubset(
      config, dimName, hierName, subsetName,
      { Expression: expression, ...aliasBody(alias, true) },
      isPrivate, vscode.l10n.t('Overwrite subset "{0}"', subsetName),
    );
  } else {
    const body = {
      Name: subsetName,
      'Hierarchy@odata.bind': `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`,
      Expression: expression,
      ...aliasBody(alias),
    };
    await createSubset(config, dimName, hierName, body, isPrivate, vscode.l10n.t('Create subset "{0}"', subsetName));
  }
  const prefix = isPrivate ? vscode.l10n.t('Private subset') : vscode.l10n.t('Subset');
  return exists
    ? vscode.l10n.t('{0} "{1}" overwritten.', prefix, subsetName)
    : vscode.l10n.t('{0} "{1}" saved.', prefix, subsetName);
}

export async function fetchSubsets(
  dimName: string, hierName: string, config: Tm1Config,
): Promise<SubsetRef[]> {
  const { pub, priv } = await listSubsetInfos(config, dimName, hierName);
  return [
    ...pub.map(s => ({ name: s.name, isPrivate: false, isDynamic: s.isDynamic })),
    ...priv.map(s => ({ name: s.name, isPrivate: true, isDynamic: s.isDynamic })),
  ];
}

/**
 * Resolved element names PLUS the subset's current MDX expression and display
 * alias.
 *
 * All three come back together so every browser path that opens a subset — the
 * tree command and the in-browser dropdown alike — learns whether it is dynamic
 * and which alias its members were saved to be shown under. The two calls are
 * independent, so they run in parallel; a failing `getSubset` degrades to
 * "static, no alias" rather than failing the element load.
 *
 * A failed read (`ok: false`) keeps that null on purpose — no branch on the flag
 * here: the webview uses the expression only to fill its MDX bar and to OFFER a
 * dynamic save, so null merely withholds an offer, it never arms a destructive
 * path.
 * The one place where "static" is acted upon destructively is the overwrite, and
 * that one re-reads the server state itself (`confirmFlattenDynamicSubset`)
 * instead of trusting anything cached here.
 */
export async function fetchSubsetElements(
  dimName: string, hierName: string, subsetName: string, isPrivate: boolean, config: Tm1Config,
): Promise<{
  elements: string[]; expression: string | null; alias: string | null;
  complete: boolean; expressionKnown: boolean;
}> {
  const [list, info] = await Promise.all([
    listSubsetElementNames(config, dimName, hierName, subsetName, isPrivate)
      .catch(() => ({ elements: [] as string[], complete: false })),
    getSubset(config, dimName, hierName, subsetName, isPrivate).catch(() => null),
  ]);
  // A truncated read must never become the basis of a write — see `noteSubsetRead`.
  noteSubsetRead(config, dimName, hierName, subsetName, isPrivate, list.complete);
  // `info === null` (request threw) and `ok === false` (non-2xx) both mean the
  // expression is UNKNOWN — which is not the same as "the subset has none".
  const expressionKnown = !!info && info.ok !== false;
  return {
    elements: list.elements,
    expression: info?.Expression ?? null,
    alias: info?.Alias ?? null,
    complete: list.complete,
    expressionKnown,
  };
}

/**
 * Which subsets were last read INCOMPLETELY, per server.
 *
 * The overwrite path writes exactly the member list its editor holds. That list
 * comes from `listSubsetElementNames`, which ends early when a page fails — so a
 * single HTTP 500 on page 2 would silently shorten a production subset, and the
 * user would see a normal save. Guarding inside `saveSubset` alone cannot help:
 * a fresh read succeeding there says nothing about the read the list came from.
 * Hence the flag travels with the read and is checked at the write.
 */
const _incompleteReads = new Set<string>();

function readKey(
  config: Tm1Config, dim: string, hier: string, subset: string, isPrivate: boolean,
): string {
  return `${cacheScope(config)}|${dim}|${hier}|${subset}|${isPrivate ? 'p' : 'x'}`;
}

/** Records whether the last element read of this subset was complete. */
export function noteSubsetRead(
  config: Tm1Config, dim: string, hier: string, subset: string, isPrivate: boolean, complete: boolean,
): void {
  const key = readKey(config, dim, hier, subset, isPrivate);
  if (complete) { _incompleteReads.delete(key); } else { _incompleteReads.add(key); }
}

/** Test seam — drops all recorded read states. */
export function _clearSubsetReadStateForTest(): void { _incompleteReads.clear(); }
