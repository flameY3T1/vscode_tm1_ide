// src/tm1Rest/defaultMemberApi.ts
//
// Read and set the default element of a hierarchy.
//
// TM1 offers NO direct REST path for this: `PATCH Hierarchies('h')` with
// `DefaultMember@odata.bind` answers with HTTP 200 and does nothing,
// `DefaultMemberName` is not a valid property, `PUT …/DefaultMember/$ref`
// is rejected, and `$metadata` has no matching action. The only path goes
// through the control cube `}HierarchyProperties` plus the TI function
// `RefreshMdxHierarchy` (measured live on 11.8.02900.8, see
// defaultMemberProbe{1..10}.js).
//
// vscode-free per rule `tm1rest-no-vscode`: the caller hands in user-facing
// text as `labels`.
import { apiRequest } from './client';
import type { Tm1Config } from './transport/types';
import { encodeODataKey } from '../utils/odataKey';
import type { DefaultMemberState } from '../dimensionEditor/model';
import { fetchDefaultMember } from './dimensionElementsApi';
import { executeTransientProcess } from './transientProcess';
import { readCellValues } from './cellValues';
import {
  dimensionToken, buildExplicitReadMdx, buildSetDefaultMemberTi,
} from './defaultMemberPure';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';

export type { DefaultMemberState };

/**
 * Reads effective and explicitly set default elements.
 *
 * Two sources, because they answer different questions: `GET …/DefaultMember`
 * returns the EFFECTIVE value (which TM1 derives if needed), the control cube
 * the EXPLICITLY SET one. Without the distinction, every dimension would look
 * configured.
 *
 * A failure in the batched MDX degrades to "nothing set" instead of throwing:
 * the effective value is the more important piece of information, and the UI
 * then simply shows no "set" marker.
 */
export async function readDefaultMembers(
  dim: string, hiers: string[], cfg: Tm1Config,
): Promise<DefaultMemberState[]> {
  if (hiers.length === 0) { return []; }
  const tokens = hiers.map(h => dimensionToken(dim, h));

  const res = await readCellValues(cfg, buildExplicitReadMdx(tokens)).catch((e: unknown) => { logRestBestEffort('defaultMember', 'read default members', e); return undefined; });
  const cells = res?.ok ? res.cells : [];

  const states: DefaultMemberState[] = [];
  for (let i = 0; i < hiers.length; i++) {
    const raw = cells[i]?.Value;
    states.push({
      hierarchy: hiers[i],
      effective: await fetchDefaultMember(dim, hiers[i], cfg),
      explicit: typeof raw === 'string' ? raw : '',
    });
  }
  return states;
}

/** User-facing text for the write path. `{0}`/`{1}` are formatted by the caller. */
export interface DefaultMemberLabels {
  /** `{0}` = element name, `{1}` = hierarchy. */
  readonly unknownElement: string;
  /** `{0}` = the wanted element, `{1}` = what TM1 uses instead. */
  readonly verifyFailed: string;
  /** `{0}` = what is still set. */
  readonly resetFailed: string;
}

function fill(tpl: string, ...args: string[]): string {
  return tpl.replace(/\{(\d)\}/g, (_m, i: string) => args[Number(i)] ?? '');
}

const eq = (a: string | null, b: string | null): boolean =>
  (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Does the element exist in exactly this hierarchy? */
async function elementExists(
  dim: string, hier: string, member: string, cfg: Tm1Config,
): Promise<boolean> {
  const url = `Dimensions('${encodeODataKey(dim)}')/Hierarchies('${encodeODataKey(hier)}')`
    + `/Elements('${encodeODataKey(member)}')?$select=Name`;
  const res = await apiRequest('GET', url, undefined, undefined, cfg);
  return isOk(res);
}

/**
 * Sets the default element (`member`) or resets it (`member === null`).
 *
 * Four steps, and the first and the last are the actual reason for this
 * module: TM1 acknowledges an unknown element name with
 * `CompletedSuccessfully`, keeps the garbage in the cell, and silently falls
 * back to the derived value when read. Without the up-front check and the
 * read-back verification, every success message here would be a guess.
 */
export async function setDefaultMember(
  dim: string, hier: string, member: string | null,
  cfg: Tm1Config, labels: DefaultMemberLabels,
): Promise<DefaultMemberState> {
  if (member !== null && !await elementExists(dim, hier, member, cfg)) {
    throw new Error(fill(labels.unknownElement, member, hier));
  }

  const token = dimensionToken(dim, hier);
  await executeTransientProcess(cfg, {
    name: '}VSCode_SetDefaultMember',
    prolog: buildSetDefaultMemberTi(token, member ?? ''),
  });

  const [state] = await readDefaultMembers(dim, [hier], cfg);
  if (member === null) {
    if (state.explicit !== '') { throw new Error(fill(labels.resetFailed, state.explicit)); }
  } else if (!eq(state.effective, member)) {
    throw new Error(fill(labels.verifyFailed, member, state.effective ?? ''));
  }
  return state;
}
