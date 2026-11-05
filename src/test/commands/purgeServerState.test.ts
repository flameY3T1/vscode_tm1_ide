import { describe, it, expect } from 'vitest';
import { purgeServerState, type PurgeMemento } from '../../commands/serverManager/purgeServerState';
import {
  SERVER_STATE_KEYS, ATTRCOL_STATE_KEY, WORKBENCH_STATE_KEY, CC_VIEW_KEY,
  LINT_CONFIG_KEY, MDX_HISTORY_KEY, TI_CONSOLE_HISTORY_KEY, USER_ALIAS_KEY, RECENT_ITEMS_KEY,
} from '../../serverState/stateKeys';

function fakeCtx(seed: Record<string, unknown> = {}): PurgeMemento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    globalState: {
      get: <T>(k: string) => store.get(k) as T | undefined,
      keys: () => [...store.keys()],
      update: async (k: string, v: unknown) => {
        if (v === undefined) { store.delete(k); } else { store.set(k, v); }
      },
    },
  };
}

const ID = 'srv-1';
const URL = 'https://tm1.example:8010';

/** One sample entry per store, so that the test grows along when someone
 *  adds a store to `SERVER_STATE_KEYS` but does not clean it up. */
function volleAblage(): Record<string, unknown> {
  return {
    [LINT_CONFIG_KEY]: { [URL]: { rules: {} }, 'https://andere:8010': { rules: {} } },
    'tm1.formatConfig': { [URL]: { keywordCase: 'lower' } },
    'tm1.ruleFormatConfig': { [URL]: { keywordCase: 'upper' } },
    'tm1.rulesLintConfig': { [URL]: { rules: {} } },
    'tm1.processGroupSuffixByServer': { [ID]: '_v', 'srv-2': '_x' },
    'tm1.processGroupModeByServer': { [ID]: 'suffix', 'srv-2': 'prefix' },
    'tm1.valueNaming.excludes': { [URL]: ['x'] },
    [MDX_HISTORY_KEY]: { [URL]: [{ mdx: 'SELECT' }] },
    [TI_CONSOLE_HISTORY_KEY]: { [URL]: [{ code: 'SaveDataAll();' }] },
    [USER_ALIAS_KEY]: { [ID]: 'Name', 'srv-2': 'Caption' },
    [ATTRCOL_STATE_KEY]: {
      [`${encodeURIComponent(ID)}::Region`]: { cols: ['a'], widths: {} },
      [`${encodeURIComponent('srv-2')}::Region`]: { cols: ['b'], widths: {} },
    },
    [WORKBENCH_STATE_KEY]: [{ serverId: ID, name: 'w1' }, { serverId: 'srv-2', name: 'w2' }],
    [RECENT_ITEMS_KEY]: [
      { kind: 'process', serverId: ID, name: 'fav', ts: 1, pinned: true },
      { kind: 'process', serverId: 'srv-2', name: 'other', ts: 3, pinned: true },
    ],
    [CC_VIEW_KEY]: {
      [`${encodeURIComponent(ID)}::D%00H`]: { ref: 'Legal', cmp: [] },
      [`${encodeURIComponent('srv-2')}::D%00H`]: { ref: 'Legal', cmp: [] },
    },
    [`tm1.lastParams:${URL}|Prozess`]: { p1: '7' },
  };
}

describe('purgeServerState', () => {
  it('clears every store of the table and the remembered parameters', async () => {
    const ctx = fakeCtx(volleAblage());
    const weg = await purgeServerState(ctx, { serverId: ID, serverUrl: URL, urlStillInUse: false });

    // All table entries + 1 parameter key
    expect(weg).toBe(SERVER_STATE_KEYS.length + 1);
    expect(ctx.store.get(LINT_CONFIG_KEY)).toEqual({ 'https://andere:8010': { rules: {} } });
    expect(ctx.store.get(MDX_HISTORY_KEY)).toEqual({});
    expect(ctx.store.get(USER_ALIAS_KEY)).toEqual({ 'srv-2': 'Caption' });
    expect(ctx.store.get(ATTRCOL_STATE_KEY)).toEqual({
      [`${encodeURIComponent('srv-2')}::Region`]: { cols: ['b'], widths: {} },
    });
    expect(ctx.store.get(WORKBENCH_STATE_KEY)).toEqual([{ serverId: 'srv-2', name: 'w2' }]);
    expect(ctx.store.has(`tm1.lastParams:${URL}|Prozess`)).toBe(false);
  });

  it('removes the deleted server\'s recent entries, pinned favorites included', async () => {
    const ctx = fakeCtx(volleAblage());
    await purgeServerState(ctx, { serverId: ID, serverUrl: URL, urlStillInUse: true });
    expect(ctx.store.get(RECENT_ITEMS_KEY)).toEqual([
      { kind: 'process', serverId: 'srv-2', name: 'other', ts: 3, pinned: true },
    ]);
  });

  it('leaves url-keyed stores in place when a profile keeps the same URL', async () => {
    // Two profiles may carry the same instance with different users
    // — the linter rules then still belong to the remaining one.
    const ctx = fakeCtx(volleAblage());
    await purgeServerState(ctx, { serverId: ID, serverUrl: URL, urlStillInUse: true });

    expect(ctx.store.get(LINT_CONFIG_KEY)).toHaveProperty(URL);
    expect(ctx.store.get(MDX_HISTORY_KEY)).toHaveProperty(URL);
    expect(ctx.store.has(`tm1.lastParams:${URL}|Prozess`)).toBe(true);
    // The id-keyed ones, on the other hand, hang on the profile and go with it.
    expect(ctx.store.get(USER_ALIAS_KEY)).toEqual({ 'srv-2': 'Caption' });
    expect(ctx.store.get(WORKBENCH_STATE_KEY)).toEqual([{ serverId: 'srv-2', name: 'w2' }]);
  });

  it('writes nothing when there is nothing to clear', async () => {
    const ctx = fakeCtx(volleAblage());
    let schreibt = 0;
    const echt = ctx.globalState.update;
    ctx.globalState.update = async (k: string, v: unknown) => { schreibt++; await echt(k, v); };
    const weg = await purgeServerState(ctx, {
      serverId: 'unbekannt', serverUrl: 'https://nichts:1', urlStillInUse: false,
    });
    expect(weg).toBe(0);
    expect(schreibt).toBe(0);
  });

  it('copes with broken and missing stores', async () => {
    const ctx = fakeCtx({
      [LINT_CONFIG_KEY]: 'kein Objekt',
      [WORKBENCH_STATE_KEY]: { keinArray: true },
      [ATTRCOL_STATE_KEY]: null,
    });
    await expect(purgeServerState(ctx, { serverId: ID, serverUrl: URL, urlStillInUse: false }))
      .resolves.toBe(0);
  });

  it('skips a memento without keys() instead of throwing', async () => {
    const store = new Map<string, unknown>(Object.entries(volleAblage()));
    const ctx = {
      globalState: {
        get: <T>(k: string) => store.get(k) as T | undefined,
        update: async (k: string, v: unknown) => { store.set(k, v); },
      },
    } as unknown as PurgeMemento;
    const weg = await purgeServerState(ctx, { serverId: ID, serverUrl: URL, urlStillInUse: false });
    expect(weg).toBe(SERVER_STATE_KEYS.length);
    expect(store.has(`tm1.lastParams:${URL}|Prozess`)).toBe(true);
  });
});
