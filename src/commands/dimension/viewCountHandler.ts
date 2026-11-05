import { fetchViewCount } from '../../tm1Rest/dimensionElementsApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/dimensionBrowser/protocol';
import { answerOrError } from './viewAnswer';

/** The request, straight from the protocol — no hand copy sitting next to it. */
export type FetchViewCountMsg = Extract<WebviewToHost, { type: 'fetchViewCount' }>;

type ViewCountAnswer = Extract<HostToWebview, { type: 'viewCount' }>;

/**
 * Answer the total count.
 *
 * Does NOT throw — the same shape as `handleFetchViewRows`, and for the same
 * reason; for both it now lives in `answerOrError` (build the payload inside
 * the `try`, post after the `catch`), so it does not have to be maintained
 * twice.
 *
 * `fetchViewCount` returns `-1` when the server names no `Cardinality` —
 * deliberately not `0`: on `-1`, the display falls back to the left-hand
 * number alone, whereas `0` would be the claim "empty set".
 */
export async function handleFetchViewCount(
  msg: FetchViewCountMsg,
  config: Tm1Config,
  post: (m: ViewCountAnswer) => void,
): Promise<void> {
  await answerOrError<ViewCountAnswer>(
    async () => ({
      type: 'viewCount', requestId: msg.requestId,
      dimName: msg.dimName, hierName: msg.hierName,
      ok: true, total: await fetchViewCount(msg.mdx, config),
    }),
    (message) => ({
      type: 'viewCount', requestId: msg.requestId,
      dimName: msg.dimName, hierName: msg.hierName, ok: false, message,
    }),
    post,
  );
}
