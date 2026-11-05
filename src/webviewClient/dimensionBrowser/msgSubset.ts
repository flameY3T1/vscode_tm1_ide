/**
 * Messages around subsets — the responses that the single load path needs.
 *
 * Until 2026-08-23 this file also held the whole aftermath of the old renderer
 * (mirror in the list, page base, MDX bar, race guard against the
 * dropdown). It falls away with the old path: what these two responses
 * cause today is decided by the VIEW (`subsetSource.ts`), and it reports that
 * with a `true`.
 */

import type { HostToWebview } from './protocol';
import { loadSubsetIntoView, applyDefaultMemberInView } from './subsetSource';

export {};

type Handler<K extends HostToWebview['type']> =
  (msg: Extract<HostToWebview, { type: K }>) => void;

export const subsetHandlers: {
  [K in 'setSubsetElements' | 'setDefaultMember']: Handler<K>
} = {
  // A real subset pick: the members become the base of the view.
  setSubsetElements: (msg) => { loadSubsetIntoView(msg); },
  // "Default element": a view made of exactly this one element. An empty
  // name changes nothing — the dimension then has none.
  setDefaultMember: (msg) => { applyDefaultMemberInView(msg.name ?? null); },
};
