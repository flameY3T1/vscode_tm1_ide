// src/commands/dimension/viewAnswer.ts
//
// The shared shape of the two view answers (`viewRows`, `viewCount`).
// Previously it was written out twice, identical except for two lines —
// including the comment that explains WHY it looks the way it does.
import { errMsg } from '../../utils/errMsg';

/**
 * Answer a view query: build the payload INSIDE the `try`, post it ONLY
 * AFTERWARD.
 *
 * This order is the actual substance of the helper. The `WebviewPanelHost`
 * does not dispose the `onDidReceiveMessage` subscription (a documented
 * pitfall, docs/architecture/webview-templates.md) — a `post` against a panel that has since died throws.
 * If it stood INSIDE the `try`, a successful fetch would run into the
 * `catch` and turn into an error message, and the second `post` in the
 * `catch` would in turn throw.
 *
 * Does NOT throw: an error goes back as `ok: false` together with TM1's own
 * message, because the display has to name it instead of silently falling
 * back.
 *
 * @param build   The success payload — may throw.
 * @param fail  The error payload built from the message. It must carry the
 *                same scope stamps (`dimName`/`hierName`) as the success
 *                case, otherwise the central guard (`MSG_SCOPE`) cannot
 *                discard a message belonging to the OLD hierarchy (K11).
 */
export async function answerOrError<TAnswer>(
  build: () => Promise<TAnswer>,
  fail: (message: string) => TAnswer,
  post: (m: TAnswer) => void,
): Promise<void> {
  let payload: TAnswer;
  try {
    payload = await build();
  } catch (e) {
    payload = fail(errMsg(e));
  }
  post(payload);
}
