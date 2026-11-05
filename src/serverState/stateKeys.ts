/**
 * All `globalState` stores that HANG OFF A SERVER — in one place.
 *
 * Without this table, the storage key would live only in the respective
 * store module, and `deleteServer` would have to import each of them
 * individually. That doesn't work: `mdxRunner` and `userGroupManager` pull in
 * webview panels, and their imports close a cycle back to `serverManager`
 * (measured against `attrColumnStore`: 43 `no-circular` violations from one
 * line). Hence a LEAF module without imports that knows only the keys and
 * their shape — `purgeServerState.ts` cleans up through it generically,
 * without seeing a single store module.
 *
 * Whoever adds a server-bound store enters it HERE. Otherwise its contents
 * survive the deletion of the profile, unreachable.
 */

/**
 * What the entry is keyed to.
 *
 * `id` — profile id (`ServerProfile.id`). Unique, always cleanable.
 *
 * `url` — `serverUrl`. **Not** unique: two profiles are allowed to point to
 * the same instance with different users (`_sessionCacheKey` carries the
 * user and auth type along). `deleteServer` may only clean up such stores
 * when NO remaining profile carries the same URL.
 *
 * That two logins to the same instance share the linter and formatting
 * rules is INTENTIONAL, not a gap: the TM1 user is not the human — both
 * profiles sit in one VS Code in front of one screen, and the rules describe
 * the MODEL (name prefixes, disabled rules), not the login. Separating them
 * per login would be the actual bug: you'd set the rules up as admin and
 * then not find them again as a reader. Conversely, the CAM alias attribute
 * hangs off the profile, because it is a login-specific trait — hence `id`.
 *
 * KNOWN EDGE CASE (measured 2026-08-29, not fixed): on **v12**, `serverUrl`
 * is only the gateway root. Instance and database live in `cfg.v12` and only
 * get added at URL-build time (`transport/urlBuilder.ts`), as well as in the
 * session key, where `transport/session.ts` notes it explicitly
 * ("append instance and database to distinguish same gateway+user with
 * different databases"). Two v12 profiles on the SAME gateway with
 * DIFFERENT databases therefore share `serverUrl` — meaning linter rules,
 * formatting rules, value-naming exceptions and MDX history, even though
 * they are two different models.
 *
 * Left this way deliberately. The damage is small (one shared default; the
 * MDX history shows queries against cubes of the other database), and the
 * cleanup errs in the safe direction: `urlStillInUse` stays true, so nothing
 * gets deleted — the failure mode is a leftover, not a loss. Extending the
 * key to instance+database, on the other hand, would be a FORMAT CHANGE:
 * every configuration currently sitting under the bare `serverUrl` would
 * become unfindable, and every user would find themselves back at the
 * defaults once. If it does turn out to be a problem, the way forward is a
 * migration on read (old key found ⇒ store it under the new one), not a
 * bare key swap.
 */
export type ServerKeySpace = 'id' | 'url';

/** Shape of the store under the key. */
export type StateShape =
  /** `Record<serverKey, …>` — the key IS the server reference. */
  | { kind: 'record' }
  /**
   * `Record<encodeURIComponent(serverKey) + '::' + …, …>` — composed from
   * the server reference and the subject. Cleaned up via the prefix.
   * `encodeURIComponent` BEFORE composing, so a raw `::` in the result can
   * only come from the separator.
   */
  | { kind: 'prefixedRecord' }
  /** Array of entries with a field that carries the server reference. */
  | { kind: 'list'; field: string };

export interface ServerStateKey {
  key: string;
  space: ServerKeySpace;
  shape: StateShape;
  /** What the entry stands for — appears only here, as a reading aid. */
  what: string;
}

/**
 * The keys themselves — every store module imports its own from HERE, so
 * the table and the store can't drift apart. `v1` in a key means: a later
 * format gets a NEW key instead of overwriting the old one.
 */
export const LINT_CONFIG_KEY = 'tm1.lintConfig';
export const FORMAT_CONFIG_KEY = 'tm1.formatConfig';
export const RULE_FORMAT_CONFIG_KEY = 'tm1.ruleFormatConfig';
export const RULES_LINT_CONFIG_KEY = 'tm1.rulesLintConfig';
export const VALUE_NAMING_EXCLUDES_KEY = 'tm1.valueNaming.excludes';
export const MDX_HISTORY_KEY = 'tm1.mdx.history';
export const TI_CONSOLE_HISTORY_KEY = 'tm1.tiConsole.history';
export const USER_ALIAS_KEY = 'tm1.security.userAliasByServer';
export const ATTRCOL_STATE_KEY = 'tm1.dimBrowser.attrColumns.v1';
export const WORKBENCH_STATE_KEY = 'tm1.workbenches.v1';
// Process-grouping override per profile (token + mode). Until 2026-08-30
// these sat outside this table: each store was correct on its own, but
// `deleteServer` never cleaned them up — the entries survived the deletion
// of the profile, unreachable in globalState. Exactly the case this table
// exists for.
export const PG_SUFFIX_KEY = 'tm1.processGroupSuffixByServer';
export const PG_MODE_KEY = 'tm1.processGroupModeByServer';
// "Recent & Favorites" entries, pinned ones included. Outside this table until
// 2026-09-26: a deleted (or re-imported, new id) server left its favorites
// behind for good, since clearing the list keeps pinned entries.
export const RECENT_ITEMS_KEY = 'tm1.recent.items';
// Last picks of the consolidation compare per dimension and hierarchy.
export const CC_VIEW_KEY = 'tm1.consolidationCompare.view.v1';

// Deliberately NOT in the table: `tm1.tree.expandedIds` and
// `tm1.tree.controlObjectsShown` are workspaceState (this table is globalState
// only) and are cleaned on `onProfileRemoved` in extension.ts.
export const SERVER_STATE_KEYS: readonly ServerStateKey[] = [
  { key: LINT_CONFIG_KEY, space: 'url', shape: { kind: 'record' }, what: 'Linter-Regeln des Prozesseditors' },
  { key: FORMAT_CONFIG_KEY, space: 'url', shape: { kind: 'record' }, what: 'Formatierregeln des Prozesseditors' },
  { key: RULE_FORMAT_CONFIG_KEY, space: 'url', shape: { kind: 'record' }, what: 'Formatierregeln des Regeleditors' },
  { key: RULES_LINT_CONFIG_KEY, space: 'url', shape: { kind: 'record' }, what: 'Linter-Regeln des Regeleditors' },
  { key: VALUE_NAMING_EXCLUDES_KEY, space: 'url', shape: { kind: 'record' }, what: 'Ausnahmen der Wertnamenspruefung' },
  { key: MDX_HISTORY_KEY, space: 'url', shape: { kind: 'record' }, what: 'MDX-Verlauf' },
  { key: TI_CONSOLE_HISTORY_KEY, space: 'url', shape: { kind: 'record' }, what: 'Verlauf der TI-Konsole' },
  { key: USER_ALIAS_KEY, space: 'id', shape: { kind: 'record' }, what: 'Alias-Attribut der Benutzerliste' },
  { key: ATTRCOL_STATE_KEY, space: 'id', shape: { kind: 'prefixedRecord' }, what: 'Attributspalten des Dimension Browsers' },
  { key: WORKBENCH_STATE_KEY, space: 'id', shape: { kind: 'list', field: 'serverId' }, what: 'gespeicherte Fenster' },
  { key: PG_SUFFIX_KEY, space: 'id', shape: { kind: 'record' }, what: 'Gruppierungstoken der Prozessliste' },
  { key: PG_MODE_KEY, space: 'id', shape: { kind: 'record' }, what: 'Gruppierungsart der Prozessliste' },
  { key: RECENT_ITEMS_KEY, space: 'id', shape: { kind: 'list', field: 'serverId' }, what: 'Recent & Favorites entries' },
  { key: CC_VIEW_KEY, space: 'id', shape: { kind: 'prefixedRecord' }, what: 'Last picks of the consolidation compare' },
] as const;

/**
 * The prefix of a composed key.
 *
 * Must match what `dimension/attrColumnStore.ts` builds when writing — both
 * sides therefore rely on the same `encodeURIComponent`.
 */
export function prefixFor(serverKey: string): string {
  return encodeURIComponent(serverKey) + '::';
}
