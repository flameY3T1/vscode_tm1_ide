/**
 * What has to happen with an MDX that the host passes along on open.
 *
 * When the `initialMdx` parameter came into being, it had exactly one caller:
 * `newMdxViewCommand` builds a **template** that belongs in the MDX window so
 * that the user edits it. Restoring a workbench, however, hands over something
 * different — the state the window **last showed**. That one is meant to be
 * executed.
 *
 * This cannot be recognised from the expression itself; it is an intent of the
 * caller. It is therefore carried in the message, and the default stays the old
 * one so that `newMdxViewCommand` keeps running unchanged.
 */
export interface InitialMdxCarrier {
  initialMdx?: string | null;
  initialMdxRun?: boolean;
}

export type InitialMdxAction = 'none' | 'edit' | 'run';

export function initialMdxAction(msg: InitialMdxCarrier): InitialMdxAction {
  const mdx = (msg.initialMdx ?? '').trim();
  if (!mdx) { return 'none'; }
  return msg.initialMdxRun ? 'run' : 'edit';
}
