/**
 * Alias: tm1s.cfg name <-> REST leaf, when the two are named DIFFERENTLY.
 *
 * The editor looks up a parameter's value via `resolveWritePath`, and that
 * is a suffix search plus the rewrite table from `configApi.ts`. Four
 * parameters fall through both, because their REST leaf is neither named the same nor
 * CARRIES the same value:
 *
 *   HTTPSessionTimeoutMinutes    Access.HTTP.SessionTimeout            "P0DT02H00M00S"
 *   IdleConnectionTimeOutSeconds Access.Network.IdleConnectionTimeOut  "P0DT00H00M00S"
 *   ServerCAMURI                 Access.CAM.ServerURIs                 []
 *   MTQ                          Performance.MTQ.UseAllThreads         true
 *                              + Performance.MTQ.NumberOfThreadsToUse  -4 | 4 | null
 *
 * Consequence until 2026-08-31: the row showed "—" although the value was
 * visible one row further down under the leaf name.
 *
 * Measured on the 11.8 test server (11.8.02900.8) on 2026-08-31 — READING and
 * WRITING, both:
 *
 * - `Access.HTTP.SessionTimeout` = "P0DT02H00M00S" with 120 minutes in the cfg.
 * - All five leaves are in StaticConfiguration AND in
 *   ActiveConfiguration, so they take effect immediately. That is why they are
 *   editable here and not read-only: static would mean "effective after
 *   restart", not "unchangeable".
 * - `{UseAllThreads:false, NumberOfThreadsToUse:-4}` -> HTTP 200, reads back
 *   as -4. Negative values are permitted (all cores minus N).
 * - `{UseAllThreads:true}` alone sets `NumberOfThreadsToUse` to null.
 * - **SENDING ALONG `NumberOfThreadsToUse: null` deletes both fields.**
 *   That is why the ALL case below sends ONLY the flag and not additionally an
 *   empty number field — a restore failed on exactly that once
 *   during measuring.
 *
 * Free of vscode and without side effects, so that it can be tested without a mock;
 * the caller builds the error texts from `expected`.
 */

/**
 * Seconds from an ISO-8601 duration, as TM1 delivers it (`P0DT02H00M00S`).
 * `undefined` for anything that does not match this form — a guessed value
 * would be worse than an empty cell.
 */
export function isoDurationToSeconds(raw: unknown): number | undefined {
  if (typeof raw !== 'string') { return undefined; }
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(raw.trim());
  if (!m) { return undefined; }
  const [, d, h, min, s] = m;
  if (d === undefined && h === undefined && min === undefined && s === undefined) { return undefined; }
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/** Reverse direction, in the notation TM1 itself delivers (two-digit). */
export function secondsToIsoDuration(total: number): string {
  const t = Math.round(total);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `P${d}DT${pad(h)}H${pad(m)}M${pad(s)}S`;
}

/**
 * Does this value carry an ISO-8601 duration?
 *
 * Detection is by VALUE, not by a name list: TM1 emits every time span in
 * this form, across `Access.Network.*`, `Administration.*` and the
 * thresholds of the event log. A list would be outdated immediately — the
 * snapshot never is.
 */
export function isIsoDuration(value: unknown): boolean {
  return isoDurationToSeconds(value) !== undefined;
}

export interface ReadAlias {
  /** Leaf the value is taken from — shown as its origin in the form. */
  leaf: string;
  /** Converted value, or `undefined` if the leaf is missing or does not fit. */
  value: unknown;
}

/** What comes out when writing: either path/value pairs or a complaint. */
export type WriteAlias =
  | { kind: 'entries'; entries: Array<[string, unknown]> }
  | { kind: 'invalid'; expected: 'nonNegativeNumber' | 'mtq' };

interface AliasDef {
  /** Leaf read from. When writing there can be several. */
  leaf: string;
  /**
   * All leaves this name covers. The editor hides them as a row of their own
   * — otherwise two editable fields would point to the same target
   * (`HTTPSessionTimeoutMinutes` in minutes next to `Access.HTTP.SessionTimeout`
   * in seconds), and on saving the one written last would win.
   */
  covers: string[];
  read(values: ReadonlyMap<string, unknown>): unknown;
  write(raw: unknown): WriteAlias;
}

/** Number from what the form sends — depending on the field kind it delivers text or a number. */
function toNumber(raw: unknown): number | undefined {
  const t = typeof raw === 'string' ? raw.trim() : raw;
  if (t === '' || t === null || t === undefined || typeof t === 'boolean') { return undefined; }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function durationWrite(leaf: string, unitInSeconds: number) {
  return (raw: unknown): WriteAlias => {
    const n = toNumber(raw);
    if (n === undefined || n < 0) { return { kind: 'invalid', expected: 'nonNegativeNumber' }; }
    return { kind: 'entries', entries: [[leaf, secondsToIsoDuration(n * unitInSeconds)]] };
  };
}

const ALIASES: Record<string, AliasDef> = {
  HTTPSessionTimeoutMinutes: {
    leaf: 'Access.HTTP.SessionTimeout',
    covers: ['Access.HTTP.SessionTimeout'],
    read: (v) => {
      const secs = isoDurationToSeconds(v.get('Access.HTTP.SessionTimeout'));
      return secs === undefined ? undefined : secs / 60;
    },
    write: durationWrite('Access.HTTP.SessionTimeout', 60),
  },
  IdleConnectionTimeOutSeconds: {
    leaf: 'Access.Network.IdleConnectionTimeOut',
    covers: ['Access.Network.IdleConnectionTimeOut'],
    read: (v) => isoDurationToSeconds(v.get('Access.Network.IdleConnectionTimeOut')),
    write: durationWrite('Access.Network.IdleConnectionTimeOut', 1),
  },
  ServerCAMURI: {
    leaf: 'Access.CAM.ServerURIs',
    covers: ['Access.CAM.ServerURIs'],
    read: (v) => {
      const raw = v.get('Access.CAM.ServerURIs');
      if (!Array.isArray(raw)) { return undefined; }
      // An empty field means "no CAM set up" — that is a statement, not a
      // missing value, so an empty text and not an empty cell.
      return raw.join(', ');
    },
    write: (raw) => ({
      kind: 'entries',
      entries: [['Access.CAM.ServerURIs', String(raw ?? '').split(/[,;]/).map(s => s.trim()).filter(s => s !== '')]],
    }),
  },
  MTQ: {
    // One tm1s.cfg value drives two leaves: `ALL` switches `UseAllThreads`,
    // a number lands in `NumberOfThreadsToUse`. When reading the flag wins,
    // because as long as it is set the number says nothing about the behavior.
    leaf: 'Performance.MTQ.UseAllThreads',
    covers: ['Performance.MTQ.UseAllThreads', 'Performance.MTQ.NumberOfThreadsToUse'],
    read: (v) => {
      const all = v.get('Performance.MTQ.UseAllThreads');
      if (all === true) { return 'ALL'; }
      const n = v.get('Performance.MTQ.NumberOfThreadsToUse');
      if (all === false && typeof n === 'number') { return n; }
      return undefined;
    },
    write: (raw) => {
      const text = String(raw ?? '').trim();
      // Only the flag, no empty number field next to it: a `null` sent along
      // deletes both fields (measured 2026-08-31).
      if (text.toUpperCase() === 'ALL') {
        return { kind: 'entries', entries: [['Performance.MTQ.UseAllThreads', true]] };
      }
      const n = toNumber(text);
      // Negative is permitted and means "all cores minus N" — confirmed live.
      // Zero makes no sense, fractional numbers neither.
      if (n === undefined || n === 0 || !Number.isInteger(n)) { return { kind: 'invalid', expected: 'mtq' }; }
      return {
        kind: 'entries',
        entries: [['Performance.MTQ.UseAllThreads', false], ['Performance.MTQ.NumberOfThreadsToUse', n]],
      };
    },
  },
};

/**
 * Read-only echoes: a flat key of the old
 * `/Configuration` view that reports the SAME thing as a row one
 * can change.
 *
 * Read side by side on 11.8 on 2026-08-31 — the content is the same, only
 * once readable and once writable:
 *
 *   SecurityMode   "Basic"  ==  Access.Authentication.IntegratedSecurityMode "Basic"
 *   PrincipalName  ""       ==  Access.Authentication.ServicePrincipalName
 *   ClientCAMURIs  []       ==  Access.CAM.ClientURI
 *
 * The editor omits the echo AS LONG AS the editable row exists. If it is missing
 * on a server, the echo stays — then it is the only
 * information about the value.
 *
 * NOT in here: `WebCAMURI`, `DistributedOutputDir` and `ProductVersion` —
 * there is no editable counterpart for them, they are pure information.
 */
const LEGACY_ECHOES: Record<string, string> = {
  SecurityMode: 'IntegratedSecurityMode',
  PrincipalName: 'ServicePrincipalName',
  ClientCAMURIs: 'ClientCAMURI',
};

/** The editable parameter that this flat key merely mirrors. */
export function legacyEchoOf(name: string): string | undefined { return LEGACY_ECHOES[name]; }

/** All echo names — for guards and tests. */
export function legacyEchoNames(): string[] { return Object.keys(LEGACY_ECHOES); }

/** Names with an alias — for guards and tests. */
export function aliasNames(): string[] { return Object.keys(ALIASES); }

/** All leaves this name covers — they get no row of their own. */
export function aliasCoveredLeaves(name: string): string[] { return ALIASES[name]?.covers ?? []; }

/**
 * Value of a tm1s.cfg name from its differently named REST leaf.
 *
 * `undefined` if there is no alias, the server does not carry the leaf
 * (v12 no longer knows the whole `Access` group) or the value does not have the
 * expected form. Then the previous display stays.
 */
export function resolveReadAlias(
  name: string,
  values: ReadonlyMap<string, unknown>,
  paths: ReadonlySet<string>,
): ReadAlias | undefined {
  const def = ALIASES[name];
  if (!def || !paths.has(def.leaf)) { return undefined; }
  const value = def.read(values);
  return value === undefined ? undefined : { leaf: def.leaf, value };
}

/**
 * Path/value pairs for the PATCH. `undefined` if the name has no alias —
 * then the caller goes its usual way. One name CAN yield several pairs
 * (MTQ carries two leaves).
 */
export function resolveWriteAlias(name: string, raw: unknown): WriteAlias | undefined {
  return ALIASES[name]?.write(raw);
}
