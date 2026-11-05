// src/tm1Rest/subsetApi.ts
// Subset operations on Dimensions/Hierarchies.
import { apiRequest, assertOk } from './client';
import { buildBaseUrl } from './transport/urlBuilder';
import type { Tm1Config } from './transport/types';
import { parseODataValueBody, parseJsonSafe, parseBodySafe } from './parseRest';
import { assertSameOriginLink } from './odataPaging';
import { escapeODataKey } from '../utils/odataKey';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';
import { BULK_READ_CAP_MS } from './timeouts';

/** OData key escape: doubles single-quotes. */
function q(s: string): string {
  return escapeODataKey(s);
}

/** URL-safe + OData-escaped path segment. */
function encKey(s: string): string {
  return encodeURIComponent(q(s));
}

function basePath(dim: string, hier: string): string {
  return `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')`;
}

/**
 * A subset plus whether it is DYNAMIC — i.e. TM1 resolves its members from an
 * MDX `Expression` instead of a stored `Elements` collection. Callers use this
 * to mark dynamic subsets in the UI and to warn before flattening one.
 */
export interface SubsetInfo {
  name: string;
  /** true = the subset carries a non-empty MDX Expression. */
  isDynamic: boolean;
}

type SubsetCollection = 'Subsets' | 'PrivateSubsets';

/**
 * GET one subset collection with the given `$select` projection.
 * `null` = the server REJECTED the request (non-2xx) — deliberately distinct
 * from an empty collection, which comes back as `[]`.
 */
async function _listSubsetsOrNull<T>(
  cfg: Tm1Config, dim: string, hier: string, collection: SubsetCollection,
  select: string, timeoutMs?: number,
): Promise<T[] | null> {
  const res = await apiRequest(
    'GET', `${basePath(dim, hier)}/${collection}?$select=${select}&$filter=Name ne ''`,
    undefined, timeoutMs, cfg,
  );
  if (!isOk(res)) { return null; }
  return parseODataValueBody<T>(res);
}

/** GET one subset collection with the given `$select` projection. Empty array on non-2xx. */
async function _listSubsets<T>(
  cfg: Tm1Config, dim: string, hier: string, collection: SubsetCollection,
  select: string, timeoutMs?: number,
): Promise<T[]> {
  return (await _listSubsetsOrNull<T>(cfg, dim, hier, collection, select, timeoutMs)) ?? [];
}

/**
 * Listing that also reports dynamic-ness.
 *
 * `Expression` is a plain string property (not a Complex Type), so `$select` is
 * the correct — and only — way to read it in a collection query; `$expand`
 * would be rejected. Kept apart from the names-only listing on purpose: the MDX
 * text is unbounded, and the name-only consumers (TI datasource pickers) would
 * otherwise download expressions they immediately discard.
 *
 * A REJECTED projection degrades to the names-only listing instead of yielding
 * an empty list. `Subsets?$select=Name,Expression` is live-verified (11.8
 * answers 200 with populated `Expression`), and so is `PrivateSubsets` with the
 * same projection (200 across all 340 hierarchies probed) — but the tree calls
 * this for BOTH collections on every dimension, and a server, version or
 * permission set that rejects it would otherwise make every subset silently
 * vanish from the tree, with no error node and no log line. Losing the dynamic
 * marker is a far smaller regression than losing the subsets.
 */
async function _listSubsetInfos(
  cfg: Tm1Config, dim: string, hier: string, collection: SubsetCollection,
  timeoutMs?: number,
): Promise<SubsetInfo[]> {
  const rows = await _listSubsetsOrNull<{ Name: string; Expression?: string | null }>(
    cfg, dim, hier, collection, 'Name,Expression', timeoutMs,
  );
  if (rows) {
    return rows.map((s) => ({ name: s.Name, isDynamic: !!(s.Expression && String(s.Expression).trim()) }));
  }
  const names = await _listSubsets<{ Name: string }>(cfg, dim, hier, collection, 'Name', timeoutMs);
  return names.map((s) => ({ name: s.Name, isDynamic: false }));
}

/** GET .../Subsets?$select=Name,Expression (public). Empty array on non-2xx. */
export async function listPublicSubsetInfos(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<SubsetInfo[]> {
  return _listSubsetInfos(cfg, dim, hier, 'Subsets', timeoutMs);
}

/** GET .../PrivateSubsets?$select=Name,Expression. Empty array on non-2xx. */
export async function listPrivateSubsetInfos(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<SubsetInfo[]> {
  return _listSubsetInfos(cfg, dim, hier, 'PrivateSubsets', timeoutMs);
}

/** GET .../Subsets?$select=Name (public). Empty array on non-2xx. */
export async function listPublicSubsetNames(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<string[]> {
  return (await _listSubsets<{ Name: string }>(cfg, dim, hier, 'Subsets', 'Name', timeoutMs))
    .map((s) => s.Name);
}

/** GET .../PrivateSubsets?$select=Name. Empty array on non-2xx. */
export async function listPrivateSubsetNames(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<string[]> {
  return (await _listSubsets<{ Name: string }>(cfg, dim, hier, 'PrivateSubsets', 'Name', timeoutMs))
    .map((s) => s.Name);
}

/** Combined public + private subset listing, incl. the dynamic flag. */
export async function listSubsetInfos(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<{ pub: SubsetInfo[]; priv: SubsetInfo[] }> {
  const [pub, priv] = await Promise.all([
    listPublicSubsetInfos(cfg, dim, hier, timeoutMs),
    listPrivateSubsetInfos(cfg, dim, hier, timeoutMs),
  ]);
  return { pub, priv };
}

/** Check whether a subset exists. Uses HTTP 200 = exists. */
export async function subsetExists(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
): Promise<boolean> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const res = await apiRequest(
    'GET', `${basePath(dim, hier)}/${collection}('${encKey(name)}')?$select=Name`,
    undefined, undefined, cfg,
  );
  return res.statusCode === 200;
}

/** DELETE a subset. Returns false on 404, throws on other non-2xx via assertOk. */
export async function deleteSubset(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
  errorMsg?: string,
): Promise<boolean> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const res = await apiRequest(
    'DELETE', `${basePath(dim, hier)}/${collection}('${encKey(name)}')`,
    undefined, undefined, cfg,
  );
  if (res.statusCode === 404) { return false; }
  if (res.statusCode >= 300) { assertOk(res, errorMsg); }
  return true;
}

/** POST a new subset. `body` may be a pre-built object or JSON string. */
export async function createSubset(
  cfg: Tm1Config, dim: string, hier: string,
  body: Record<string, any> | string, isPrivate: boolean,
  errorMsg?: string,
): Promise<void> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest(
    'POST', `${basePath(dim, hier)}/${collection}`, bodyStr, undefined, cfg,
    { 'Content-Type': 'application/json' },
  );
  assertOk(res, errorMsg);
}

/**
 * PATCH an existing subset in place.
 *
 * This is what an overwrite must use. Delete-then-create cannot do the job:
 * TM1 refuses to delete a subset a view refers to (`HTTP 400 … subset being
 * used by view`), so the old path failed on exactly the subsets that are worth
 * keeping. Writing over one is allowed even then (live report 2026-08-02).
 *
 * `If-Match: *` is added centrally for every PATCH (transport/http.ts), so the
 * caller does not pass it. `Name` is deliberately NOT part of any body here —
 * TM1 reads a `Name` in a PATCH as a rename.
 */
export async function updateSubset(
  cfg: Tm1Config, dim: string, hier: string, name: string,
  body: Record<string, any> | string, isPrivate: boolean,
  errorMsg?: string,
): Promise<void> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest(
    'PATCH', `${basePath(dim, hier)}/${collection}('${encKey(name)}')`,
    bodyStr, undefined, cfg, { 'Content-Type': 'application/json' },
  );
  assertOk(res, errorMsg);
}

/**
 * Empty a subset's stored member list, in place.
 *
 * Needed because **a PATCH on `Elements` APPENDS, it does not replace** (live
 * 11.8, 2026-08-02: a 3-member subset PATCHed with one member ends up holding
 * 4). The same quirk as chores, where PATCH appends tasks. Neither
 * `Elements@odata.bind: []` nor a plain `Elements: []` clears anything — both
 * answer 200 and change nothing — and `PUT` is rejected outright.
 *
 * What DOES work is the OData collection-DELETE: `DELETE …/Elements/$ref?$id=…`
 * wipes the WHOLE list, despite `$id` naming a single element (`…/Elements('X')/$ref`
 * without the query removes just that one). `$id` is required — without it the
 * server answers 400 "No $id query option specified".
 *
 * An empty subset is left alone: there is no element whose URL could be named,
 * and nothing to remove.
 */
export async function clearSubsetElements(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
  errorMsg?: string,
): Promise<void> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const subset = `${basePath(dim, hier)}/${collection}('${encKey(name)}')`;
  const firstRes = await apiRequest('GET', `${subset}/Elements?$select=Name&$top=1`, undefined, undefined, cfg);
  if (!isOk(firstRes)) {
    assertOk(firstRes, errorMsg);
    return;
  }
  // An unreadable list is not an empty one: skipping the clear makes the next
  // PATCH append to the old members.
  const env = parseBodySafe<{ value?: { Name: string }[] } | null>(firstRes, null);
  if (!env || !Array.isArray(env.value)) {
    throw new Error(`${errorMsg ? `${errorMsg}: ` : ''}the member list could not be read (HTTP ${firstRes.statusCode})`);
  }
  const first = env.value[0];
  if (!first?.Name) { return; }
  // `$id` is a URL, so it carries the service-root path — `/api/v1` on v11,
  // `/<instance>/api/v1/Databases('<db>')` on v12. Derived from the same
  // builder the transport uses, never hard-coded.
  const prefix = new URL(buildBaseUrl(cfg)).pathname.replace(/\/$/, '');
  const id = `${prefix}/${subset}/Elements('${encKey(first.Name)}')`;
  const res = await apiRequest(
    'DELETE', `${subset}/Elements/$ref?$id=${encodeURIComponent(id)}`,
    undefined, undefined, cfg,
  );
  assertOk(res, errorMsg);
}

/**
 * How many members a subset holds right now, or -1 when the count could not be
 * read (advisory only — never a gate).
 *
 * Used to prove that an overwrite REPLACED the member list instead of appending
 * to it. TM1's PATCH is not uniformly replace-semantics — on chores it appends
 * tasks (live 11.8) — and a silently doubled subset is the kind of damage a
 * user only notices much later.
 */
export async function subsetElementCount(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
): Promise<number> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const path = `${basePath(dim, hier)}/${collection}('${encKey(name)}')/Elements`;
  // `$format=text/plain` is MANDATORY: the transport hard-codes
  // `Accept: application/json` (transport/auth.ts), and `/$count` only answers
  // in text/plain — without the parameter it ALWAYS comes back as 400 Code 278,
  // and the fallback below carries the answer instead. Verified live on 11.8.
  try {
    const res = await apiRequest('GET', `${path}/$count?$format=text/plain`, undefined, BULK_READ_CAP_MS, cfg);
    if (isOk(res)) {
      const n = parseInt(String(res.body ?? '').trim(), 10);
      if (Number.isFinite(n)) { return n; }
    }
  } catch { /* fall through to the inline count */ }
  // Fallback: some TM1 versions 400 on a raw `/$count`.
  try {
    const res = await apiRequest('GET', `${path}?$top=0&$count=true&$select=Name`, undefined, BULK_READ_CAP_MS, cfg);
    if (isOk(res)) {
      const env = parseJsonSafe<{ '@odata.count'?: number }>(res.body, {});
      const n = typeof env['@odata.count'] === 'number' ? env['@odata.count'] : NaN;
      if (Number.isFinite(n)) { return n as number; }
    }
  } catch (e) { logRestBestEffort('subset', 'count elements', e); /* give up → advisory only */ }
  return -1;
}

/** GET public subsets with their elements expanded. Empty array on non-2xx. */
export async function listSubsetsWithElements(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<Array<{ Name: string; Elements: Array<{ Name: string }> }>> {
  const res = await apiRequest(
    'GET',
    `${basePath(dim, hier)}/Subsets?$select=Name&$expand=Elements($select=Name)`,
    undefined, timeoutMs, cfg,
  );
  if (!isOk(res)) { return []; }
  return parseODataValueBody<{ Name: string; Elements: Array<{ Name: string }> }>(res);
}

/**
 * One subset as read back from the server.
 *
 * `ok: false` means the READ failed — `Expression`/`Alias` are then UNKNOWN, not
 * "the subset has none". Every caller that acts destructively on "this subset is
 * static" MUST branch on the flag: the fields alone cannot tell a static subset
 * apart from a subset whose state nobody could read.
 */
export interface SubsetDetail {
  ok: boolean;
  Name: string;
  Expression: string | null;
  Alias: string | null;
}

/**
 * HTTP statuses that can mean "I do not know that property" rather than "that
 * subset is gone", i.e. the ones worth a second, plainer GET.
 *
 * 11.8 answers 400, but an unknown property survives the hop through gateways
 * and older builds as 501 (not implemented) or a bare 500 just as often. A 404
 * is deliberately absent — the subset really is missing and the retry would only
 * buy the same answer a round trip later.
 */
const PROJECTION_RETRY_STATUS = new Set([400, 500, 501]);

/**
 * GET a single subset with its Expression and its display Alias.
 *
 * `Alias` is the alias attribute the subset was saved with — what the members
 * are shown under when the subset is opened. It is a real, writable property on
 * 11.8, but it is NOT declared on the `Subset` EntityType in `$metadata` (which
 * lists only Name/UniqueName/Expression/Attributes) and it is NOT part of the
 * default projection: a plain `GET .../Subsets('S')` never returns it. It only
 * answers to an explicit `$select` — verified live on 11.8, entity and
 * collection level alike (299 of 453 subsets there carried a non-empty Alias).
 *
 * Because the property is undeclared, a stricter server may refuse the
 * projection. Every status that can mean "unknown property" therefore retries
 * with the plain `Name,Expression` projection instead of degrading to "static"
 * (see `PROJECTION_RETRY_STATUS`): losing the alias is cosmetic, losing the
 * Expression would make every dynamic subset look static and let the save path
 * silently flatten it. A 404 (subset gone) is not retried — the second answer
 * would be the same.
 *
 * A read that fails anyway comes back as `ok: false` rather than as a
 * static-looking result: a 401/404/500 answer says nothing about whether the
 * subset carries MDX, and a caller that reads `Expression: null` as "static"
 * would destroy exactly that MDX. Still no throw — four call sites wrap this in
 * `.catch(() => null)` and an exception would land in the same blind spot.
 *
 * Empty Alias (the server's "no alias" value) is normalised to null.
 */
export async function getSubset(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
): Promise<SubsetDetail> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const url = (select: string): string =>
    `${basePath(dim, hier)}/${collection}('${encKey(name)}')?$select=${select}`;

  let res = await apiRequest('GET', url('Name,Expression,Alias'), undefined, undefined, cfg);
  if (PROJECTION_RETRY_STATUS.has(res.statusCode)) {
    res = await apiRequest('GET', url('Name,Expression'), undefined, undefined, cfg);
  }
  if (!isOk(res)) {
    return { ok: false, Name: name, Expression: null, Alias: null };
  }
  const data = parseJsonSafe<{ Name?: string; Expression?: string | null; Alias?: string | null } | null>(res.body, null);
  // A 2xx that is not JSON (proxy or gateway page) is as unknown as a 500.
  if (!data || typeof data !== 'object') { return { ok: false, Name: name, Expression: null, Alias: null }; }
  const alias = typeof data.Alias === 'string' && data.Alias.trim() ? data.Alias : null;
  return { ok: true, Name: data.Name ?? name, Expression: data.Expression ?? null, Alias: alias };
}

/** Result of a paged subset element read. `complete: false` = the list is a prefix
 *  of the real one (a page failed), never a statement about the subset itself. */
export interface SubsetElementList {
  elements: string[];
  complete: boolean;
  /** HTTP status of the page that stopped the read; only set when `complete` is false. */
  statusCode?: number;
}

/**
 * GET subset element names.
 *
 * Follows `@odata.nextLink` to the end. TM1 may page this collection, and a
 * dynamic subset larger than one server page would otherwise be mirrored from
 * page 1 only — the caller's preload cap never trips and the flatten warning
 * quotes a truncated count. The neighbouring dimension-browser MDX evaluator
 * pages the very same collection for the same reason. (11.8 on the reference
 * server never emitted a nextLink, not even for a 211 852-element hierarchy or
 * under `Prefer: odata.maxpagesize` — so this is forward-compatibility, and it
 * costs exactly one request when the server does not page.)
 *
 * A failing page ends the read and sets `complete: false`. It does NOT throw:
 * showing what was read is useful, and the flag is what decides whether the
 * result may be written back. Callers that feed a save path MUST refuse on
 * `complete === false` — an HTTP 500 on page 2 would otherwise truncate a
 * production subset permanently.
 */
export async function listSubsetElementNames(
  cfg: Tm1Config, dim: string, hier: string, name: string, isPrivate: boolean,
  timeoutMs?: number,
): Promise<SubsetElementList> {
  const collection = isPrivate ? 'PrivateSubsets' : 'Subsets';
  const out: string[] = [];
  let next: string | undefined =
    `${basePath(dim, hier)}/${collection}('${encKey(name)}')/Elements?$select=Name`;
  while (next) {
    const res = await apiRequest('GET', next, undefined, timeoutMs, cfg);
    if (!isOk(res)) {
      return { elements: out, complete: false, statusCode: res.statusCode };
    }
    const env = parseBodySafe<{ value?: { Name: string }[]; '@odata.nextLink'?: string } | null>(res, null);
    // An unparsable page is a failed page, not an empty one.
    if (!env || !Array.isArray(env.value)) { return { elements: out, complete: false, statusCode: res.statusCode }; }
    for (const e of env.value) { out.push(e.Name); }
    const link = env['@odata.nextLink'];
    // The server picks this URL and the transport attaches our credentials to
    // it, so refuse one that leaves the configured origin before requesting it.
    if (link) { assertSameOriginLink(link, cfg); }
    // Guard against a server echoing the page it just served — that would spin forever.
    next = link && link !== next ? link : undefined;
  }
  return { elements: out, complete: true };
}
