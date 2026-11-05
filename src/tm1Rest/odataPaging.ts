// src/tm1Rest/odataPaging.ts
//
// Generic `@odata.nextLink` follower. Lifted out of the dimension browser's
// handler file (S2-8, review 2026-08-02) because nothing about it is
// browser-specific — it is the transport-level answer to "TM1 paged my
// collection", which every bulk GET in this codebase has to deal with.
//
// vscode-free by rule (`tm1rest-no-vscode`): the `label` an `assertOk` needs is
// a user-facing string and therefore comes IN from the caller, already
// localized.
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { buildBaseUrl } from './transport/urlBuilder';
import { parseBodySafe, type ODataValueEnvelope } from './parseRest';

/**
 * Default per-page timeout. The global `apiRequest` default is 30 s, which is
 * too short for the Elements/Edges payload of a multi-100k-element dimension
 * (large-dim lever 6, 2026-06-13) — and a truncated bulk fetch is exactly what
 * this helper exists to prevent. Callers that want another budget pass
 * `timeoutMs`; every call site moved in S2-8 relied on this value.
 */
const DEFAULT_PAGE_TIMEOUT_MS = 180_000;

/**
 * Hard cap on pages per fetch. The loop is driven entirely by a server-supplied
 * `@odata.nextLink`, so without a cap a server that keeps emitting links (buggy
 * Pager, or a hostile one) spins forever while the accumulator grows. 10 000
 * pages is far past any real TM1 collection — the largest measured here is a
 * 211 852-element hierarchy, which the reference 11.8 server returns unpaged.
 */
const MAX_PAGES = 10_000;

/** An OData collection page: `value`, plus the two annotations we read off it. */
export type ODataPage<T> = ODataValueEnvelope<T> & { '@odata.nextLink'?: string };

/** Everything that varied between the hand-rolled nextLink loops (S2-9). */
export interface PageOpts<T> {
  /** Set → hard (assertOk per page). Omitted → soft: stop on the first non-2xx
   *  and return what accumulated (mirrors the old `statusCode<300 ? parse : []`). */
  label?: string;
  /** Stop once this many rows have been SEEN — the caller only wants a slice. */
  limit?: number;
  /**
   * Called per page instead of accumulating. Lets a caller map (and drop) rows
   * while the raw page is still the only copy in memory, and read a page-level
   * annotation such as `@odata.count`. With `onPage` set the return value is
   * empty — the caller owns the result.
   */
  onPage?: (rows: readonly T[], env: ODataPage<T>) => void;
  /** An already-fetched response for `firstUrl` (a page-1 request that was
   *  started in parallel with something else). Saves re-issuing it. */
  firstRes?: { statusCode: number; body: string };
  /** Per-page request timeout. Omitted → `DEFAULT_PAGE_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Can this link reach a host other than the configured one?
 *
 * Only if it carries an authority — `scheme://host…` or the protocol-relative
 * `//host…`. A bare path or query gets `buildBaseUrl`-prefixed by `apiRequest`
 * and is therefore same-origin by construction, so it needs no check (and must
 * not need a parsable config to be followed). `startsWith('http')` is included
 * because that is the exact predicate `apiRequest` uses to forward a URL
 * verbatim — anything it treats as absolute must be verified as absolute here.
 */
function carriesAuthority(link: string): boolean {
  return link.startsWith('//') || link.startsWith('http') || /^[a-z][a-z0-9+.-]*:\/\//i.test(link);
}

/**
 * Thrown by `assertSameOriginLink` for every refusal.
 *
 * A distinct type, not a bare `Error`, because two of the loops that adopt the
 * guard sit inside a catch-all that returns what it collected so far. Swallowed
 * there, "we refused to follow this link" would read as "the collection ended
 * here" — the exact confusion the guard exists to prevent. Callers whose
 * contract is best-effort can still swallow it deliberately; what they must not
 * do is swallow it *accidentally*.
 */
export class CrossOriginLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossOriginLinkError';
  }
}

/**
 * Refuse a pagination link that leaves the configured server's origin.
 *
 * The whole point of `@odata.nextLink` is that the SERVER picks the next URL.
 * `apiRequest` forwards anything starting with `http` verbatim (`client.ts`,
 * absolute-URL branch) and the transport then attaches the cached
 * `TM1SessionId` cookie — or, with no session yet, an `Authorization` header
 * that for `Basic`/`CAMNamespace` carries the base64-encoded password
 * (`transport/auth.ts#buildHeaders`). Those headers are set by hand and so have
 * none of a browser's origin binding: one page answered with
 * `https://attacker.example/...` would hand a third-party host the credentials
 * of every user who paged a large collection. Hence: resolve the link against
 * the configured base URL and require an exact scheme+host+port match.
 *
 * Deliberately a THROW, not a quiet `break`. A silently cut pagination run is
 * indistinguishable from "the collection ended here", and the callers of this
 * helper (element lists, edge lists, cube/view name lists) feed exactly that
 * kind of list into code that overwrites server objects.
 *
 * Known limitation — reverse proxies. A TM1 behind a proxy that does not
 * rewrite the links it emits (client talks to `https://proxy/tm1`, TM1 answers
 * with `http://tm1-host:8010/...`) trips this guard. That deployment cannot
 * page successfully anyway whenever the internal host is unroutable for the
 * client, and where it *is* routable it is precisely the case where the
 * password would travel to a host the user never configured. So the guard names
 * both origins in its message instead of forwarding the secret; the fix belongs
 * in the proxy (rewrite `@odata.nextLink`), not here.
 *
 * Exported because two loops page by hand rather than through `fetchAllPages`
 * and would otherwise re-derive the rule: `mdx/mdxSchemaCache.ts` (injected
 * fetcher, 404-on-page-1 counts as complete) and `tm1Rest/subsetApi.ts`
 * (partial result plus a `complete` flag) both call it. Any
 * new hand-rolled loop must do the same — `src/test/odataPagingOriginGuard.test.ts`
 * covers each of them.
 */
export function assertSameOriginLink(link: string, config: Tm1Config): void {
  if (!carriesAuthority(link)) { return; }
  const base = buildBaseUrl(config);
  let expected: URL;
  try {
    expected = new URL(base);
  } catch {
    throw new CrossOriginLinkError(
      `Cannot verify OData pagination link: the configured server URL is not absolute ("${base}").`,
    );
  }
  if (expected.protocol !== 'http:' && expected.protocol !== 'https:') {
    // e.g. `tm1host:8010` — WHATWG reads that as scheme `tm1host:`, so it parses
    // but is not an origin we can compare against. Say so, rather than blaming
    // the link the server sent.
    throw new CrossOriginLinkError(
      `Cannot verify OData pagination link: the configured server URL has no http(s) scheme ("${base}").`,
    );
  }
  let target: URL;
  try {
    // Relative links resolve against the base and therefore always pass — only
    // an absolute link can move the request to another host. Resolution against
    // a valid base never throws for a relative input, so this catch is for a
    // link with a broken absolute form.
    target = new URL(link, base);
  } catch {
    throw new CrossOriginLinkError(`Refusing to follow a malformed OData pagination link: "${link}".`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new CrossOriginLinkError(
      `Refusing to follow an OData pagination link with a non-HTTP scheme: "${link}".`,
    );
  }
  // `host` carries the port and normalizes the scheme default (`:80`/`:443`),
  // so this is the scheme+host+port comparison, not a hostname-only one.
  if (target.protocol !== expected.protocol || target.host !== expected.host) {
    throw new CrossOriginLinkError(
      `Refusing to follow a cross-origin OData pagination link: the server returned `
      + `"${target.protocol}//${target.host}" but the configured TM1 server is `
      + `"${expected.protocol}//${expected.host}". TM1 credentials are never sent to another host.`,
    );
  }
}

/**
 * GET a collection following `@odata.nextLink` to the end.
 *
 * TM1 servers with a configured Pager cap each response and return a nextLink —
 * every bulk fetch here must follow it or the result is silently truncated. This
 * is the one place that knows that; S2-9 pulled the six hand-rolled copies
 * (elements, attributes, children, subtree edges, ancestor edges, element pages)
 * onto it, each of which carried its own `(env as { '@odata.nextLink'?: string })`
 * cast and its own idea of when to stop.
 */
export async function fetchAllPages<T>(
  firstUrl: string, config: Tm1Config, opts: PageOpts<T> = {},
): Promise<T[]> {
  const out: T[] = [];
  let seen = 0;
  let pages = 0;
  let next: string | undefined = firstUrl;
  let res = opts.firstRes;
  // `firstUrl` is built in-repo from `buildBaseUrl`-relative paths, so it is
  // same-origin by construction — checked anyway so no future caller can hand
  // this loop a server-supplied absolute URL for page 1.
  assertSameOriginLink(firstUrl, config);
  while (next) {
    if (++pages > MAX_PAGES) {
      throw new Error(
        `OData pagination did not terminate: more than ${MAX_PAGES} pages for "${firstUrl}". `
        + `Aborting instead of returning a silently truncated result.`,
      );
    }
    if (!res) { res = await apiRequest('GET', next, undefined, opts.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS, config); }
    if (opts.label) { assertOk(res, opts.label); }
    else if (res.statusCode >= 300) { break; }
    const env = parseBodySafe<ODataPage<T>>(res, {});
    res = undefined;
    const rows = env.value ?? [];
    seen += rows.length;
    if (opts.onPage) { opts.onPage(rows, env); }
    else { for (const v of rows) { out.push(v); } }
    // Before touching the next link: a caller that got its slice is DONE, and
    // its result is truncated by request, not silently. Judging a link we would
    // never follow would turn a satisfied `limit` run into a failure.
    if (opts.limit !== undefined && seen >= opts.limit) { break; }
    const link = env['@odata.nextLink'];
    if (link !== undefined && link !== '') {
      assertSameOriginLink(link, config);
      if (link === next) {
        throw new Error(
          `OData pagination is looping: the server answered with the page it was just asked for `
          + `("${link}"). Aborting instead of returning a silently truncated result.`,
        );
      }
      next = link;
    } else {
      next = undefined;
    }
  }
  return out;
}
