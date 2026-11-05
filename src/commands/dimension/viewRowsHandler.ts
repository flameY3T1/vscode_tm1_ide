import {
  fetchViewRows, createMemberSet, fetchMemberSetPage, deleteMemberSet, type MemberSetHandle,
} from '../../tm1Rest/dimensionElementsApi';
import type { AnswerRow } from '../../tm1Rest/dimensionSetQueryPure';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/dimensionBrowser/protocol';
import { answerOrError } from './viewAnswer';

/** The request, straight from the protocol — the hand copy that sat here could drift. */
export type FetchViewRowsMsg = Extract<WebviewToHost, { type: 'fetchViewRows' }>;

/** The `viewRows` answer, straight from the protocol — no hand copy sitting next to it. */
type ViewRowsAnswer = Extract<HostToWebview, { type: 'viewRows' }>;

/**
 * Answer a view query.
 *
 * Does NOT throw: an error goes back as `ok: false` together with TM1's own
 * message, because the display has to name it instead of silently falling
 * back. The message names the offending token — the only thing that helps
 * with a mistyped expression. The order (build the payload inside the `try`,
 * post after the `catch`) and its rationale live in `answerOrError`.
 */
/**
 * The stored set of one panel (see `MemberSetHandle`). `gen` counts every
 * replacement, so a creation that finishes after a newer one frees its own
 * set instead of overwriting the current one.
 */
interface MemberSetSlot { cur?: { setMdx: string; handle: MemberSetHandle }; gen: number }
const _slots = new WeakMap<object, MemberSetSlot>();

/** Frees the panel's stored set — on a view without `page` and on dispose. */
export function releaseMemberSet(owner: object, config: Tm1Config): void {
  const slot = _slots.get(owner);
  if (!slot) { return; }
  slot.gen++;
  const old = slot.cur;
  slot.cur = undefined;
  if (old) { void deleteMemberSet(old.handle, config); }
}

async function loadRows(msg: FetchViewRowsMsg, config: Tm1Config, owner: object | undefined): Promise<AnswerRow[]> {
  const extras = { index: msg.rowIndex, weight: msg.rowWeight };
  const windowed = async (): Promise<AnswerRow[]> =>
    (await fetchViewRows(msg.mdx, config, msg.chain, msg.alias, msg.rowAttrs, extras)).rows;
  if (!owner) { return windowed(); }
  if (!msg.page) { releaseMemberSet(owner, config); return windowed(); }
  const slot = _slots.get(owner) ?? { gen: 0 };
  _slots.set(owner, slot);
  const { setMdx, skip } = msg.page;
  if (skip > 0) {
    // Appending: page the stored set; without a matching one, the old window.
    const cur = slot.cur?.setMdx === setMdx ? slot.cur : undefined;
    const rows = cur && await fetchMemberSetPage(cur.handle, skip, msg.top + 1, config, msg.chain, msg.alias, msg.rowAttrs, extras);
    return rows ?? windowed();
  }
  releaseMemberSet(owner, config);
  const gen = slot.gen;
  const { rows, handle } = await createMemberSet(setMdx, msg.top + 1, config, msg.chain, msg.alias, msg.rowAttrs, extras);
  if (handle) {
    if (slot.gen === gen) { slot.cur = { setMdx, handle }; } else { void deleteMemberSet(handle, config); }
  }
  return rows;
}

export async function handleFetchViewRows(
  msg: FetchViewRowsMsg,
  config: Tm1Config,
  post: (m: ViewRowsAnswer) => void,
  /** The panel — key of its stored set. Without it, every window is evaluated on its own. */
  owner?: object,
): Promise<void> {
  await answerOrError<ViewRowsAnswer>(
    async () => {
      const rows = await loadRows(msg, config, owner);
      // `hasMore` comes from the extra row, NOT from `cardinality`: under a
      // windowed expression that is the window size, not the total count
      // (measured live on 11.8, plan 1).
      const hasMore = rows.length > msg.top;
      const visible: AnswerRow[] = hasMore ? rows.slice(0, msg.top) : rows;
      return {
        type: 'viewRows', requestId: msg.requestId, dimName: msg.dimName, hierName: msg.hierName,
        ok: true, rows: visible, hasMore,
      };
    },
    // Send dim/hier along in the error branch too (K11): otherwise the
    // central guard (`MSG_SCOPE`) could not discard an error message
    // belonging to the OLD hierarchy — it would otherwise be noise in the
    // new selection.
    (message) => ({
      type: 'viewRows', requestId: msg.requestId, dimName: msg.dimName, hierName: msg.hierName,
      ok: false, message,
    }),
    post,
  );
}
