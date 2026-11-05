import type * as vscode from 'vscode';
import { listWindows } from '../../workbench/windowRegistry';
import { identityOf, kindOf, type SavedWindow } from './windowKinds';
import { splitRawKey } from './windowKindsPure';

/** An open window, as it appears in the selection window. */
export interface CandidateWindow {
  /** Only valid within one selection round. */
  id: string;
  kind: string;
  group: string;
  label: string;
  /** Preview line; missing when the kind has no state contract. */
  description?: string;
  saved: SavedWindow;
  /** Default value of the checkbox. Always `true` when saving. */
  checked: boolean;
  /** `false` = only exists in the workbench, is not currently open. */
  open: boolean;
}

/**
 * The open windows of this server, in registration order.
 *
 * The state is asked for HERE, not tracked continuously — exactly once,
 * when someone wants to save. That is the reason this function is
 * asynchronous: what a cube viewer or dimension browser SHOWS lives in the
 * webview, and asking it is a round trip. A continuously maintained mirror
 * was rejected — it produces message traffic on every user action and, if
 * it goes stale, fails SILENTLY.
 *
 * `serverId` and `serverUrl` are two different identities that are
 * deliberately checked BOTH here. `Workbench.serverId` (and therefore the
 * `serverId` the caller passes in here) is the profile id
 * (`tm1TreeDataProvider.ts` builds `{ serverId: s.id, … }`, a timestamp
 * string) — restoring needs exactly that one to find the connection via
 * `getServerConfig`. The managers, however, register their panels under the
 * server URL (`cubeViewer/manager.ts`, `rule/ruleEditor.ts`,
 * `chore/choreEditor.ts`, `dimensionBrowser.ts`: `config.serverUrl`). A
 * plain `sid !== serverId` comparison therefore NEVER found a window — that
 * was the reason "Save workbench" on a server full of windows immediately
 * reported "no open windows". The caller (`tm1.workbench.save`) therefore
 * additionally passes along `serverUrl`; a match on EITHER of the two
 * identities counts.
 */
export async function collectCandidates(
  serverId: string, serverUrl?: string, stored?: readonly SavedWindow[],
): Promise<CandidateWindow[]> {
  // Select first, then ask. Selecting is synchronous and cheap; asking is a
  // round trip per window and therefore runs CONCURRENTLY — done in
  // sequence, twenty hidden windows would mean ten seconds of cap instead
  // of half a second.
  const chosen: Array<{ kindName: string; kind: ReturnType<typeof kindOf>; rawKey: string;
                        target?: string; panel: vscode.WebviewPanel }> = [];
  for (const w of listWindows()) {
    const kind = kindOf(w.kind);
    if (kind.transient) { continue; }
    const parsed = splitRawKey(kind.keyShape ?? 'server::target', w.rawKey);
    const sid = w.serverId ?? parsed.serverId;
    if (sid !== serverId && (serverUrl === undefined || sid !== serverUrl)) { continue; }
    // `target` MUST come before `capture`: the state reader is handed the
    // known object name so it can cut it out of the key.
    chosen.push({
      kindName: w.kind, kind, rawKey: w.rawKey,
      target: w.target ?? parsed.target, panel: w.panel as vscode.WebviewPanel,
    });
  }

  const states = await Promise.all(chosen.map(async (c) => {
    try {
      return await c.kind.capture?.(c.panel, c.rawKey, c.target);
    } catch {
      // A window that falls over while being asked must not tip over the
      // collection — it gets saved like one without a state contract.
      return undefined;
    }
  }));

  const open: CandidateWindow[] = chosen.map((c, i) => {
    const saved: SavedWindow = { kind: c.kindName, target: c.target, state: states[i] };
    return {
      id: `c${i}`,
      kind: c.kindName,
      group: c.kind.group(),
      label: c.kind.label(saved),
      description: c.kind.describe?.(states[i]),
      saved,
      checked: true,
      open: true,
    };
  });

  // Saving: everything open, everything checked. Done.
  if (!stored) { return open; }

  // Editing: the UNION. Saved entries come first — they are the existing
  // set, the open ones are the proposal.
  //
  // A window that is both appears ONCE, and specifically as the open one:
  // its state was just freshly asked for, the saved one is from back then.
  // This is recognized via `identityOf` — not via `kind|target` alone,
  // otherwise two cube viewers on the same cube would merge.
  const openById = new Map<string, CandidateWindow>();
  for (const c of open) { openById.set(identityOf(c.saved), c); }

  const out: CandidateWindow[] = [];
  const used = new Set<string>();
  for (const sw of stored) {
    const id = identityOf(sw);
    const live = openById.get(id);
    if (live) {
      used.add(id);
      out.push({ ...live, checked: true });
      continue;
    }
    // Closed: the saved state stays as it is — there is no one left to
    // ask.
    const kind = kindOf(sw.kind);
    out.push({
      id: `s${out.length}`,
      kind: sw.kind,
      group: kind.group(),
      label: kind.label(sw),
      description: kind.describe?.(sw.state),
      saved: sw,
      checked: true,
      open: false,
    });
  }
  for (const c of open) {
    if (used.has(identityOf(c.saved))) { continue; }
    out.push({ ...c, checked: false });
  }
  // The ids must be unique within ONE selection round; after merging, the
  // order no longer matches the counters.
  return out.map((c, i) => ({ ...c, id: `c${i}` }));
}

/** Selection → record. The order comes from the list, not from the selection. */
export function candidatesToSaved(all: CandidateWindow[], chosenIds: string[]): SavedWindow[] {
  const chosen = new Set(chosenIds);
  return all.filter(c => chosen.has(c.id)).map(c => c.saved);
}
