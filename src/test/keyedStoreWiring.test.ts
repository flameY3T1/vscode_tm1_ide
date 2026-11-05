// Wiring test for the stores that sit on `utils/keyedStore`.
//
// The blueprint itself is tested in `keyedStore.test.ts`; this is about the
// four lines per module that connect it — storage key, context path,
// `normalize`. A typo there is caught by no other test: reading and writing
// would be equally wrong, the editor would keep showing the default values,
// and only on the next restart would someone notice that nothing was kept.
import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';

import { configureProcessEditor } from '../commands/processEditor/state';
import { loadLintConfig, saveLintConfig } from '../commands/processEditor/lintConfigStore';
import { loadFormatConfig, saveFormatConfig } from '../providers/formatConfigStore';
import { loadRuleFormatConfig, saveRuleFormatConfig } from '../providers/ruleFormatConfigStore';
import { loadExcludes, saveExcludes } from '../commands/tiValueNaming/excludeStore';
import {
  loadAttrColumns, saveAttrColumns, purgeAttrColumnsForServer,
} from '../commands/dimension/attrColumnStore';
import {
  LINT_CONFIG_KEY, FORMAT_CONFIG_KEY, RULE_FORMAT_CONFIG_KEY,
  VALUE_NAMING_EXCLUDES_KEY, ATTRCOL_STATE_KEY,
} from '../serverState/stateKeys';

const URL = 'https://tm1.example:8010';
let gs: Map<string, unknown>;
let ctx: vscode.ExtensionContext;

beforeEach(() => {
  gs = new Map<string, unknown>();
  ctx = {
    globalState: {
      get: (k: string) => gs.get(k),
      update: (k: string, v: unknown) => { gs.set(k, v); return Promise.resolve(); },
    },
  } as unknown as vscode.ExtensionContext;
  configureProcessEditor({ context: ctx });
});

describe('Stores on the keyedStore blueprint', () => {
  it('linter rules round-trip under their key', async () => {
    await saveLintConfig(URL, { rules: { 'wrong-arg-count': { enabled: false } } });
    expect(gs.get(LINT_CONFIG_KEY)).toEqual({
      [URL]: { rules: { 'wrong-arg-count': { enabled: false } } },
    });
    expect(loadLintConfig(URL).rules['wrong-arg-count']).toEqual({ enabled: false });
    // A different server stays untouched and returns the default.
    expect(loadLintConfig('https://andere:8010')).toEqual({ rules: {} });
  });

  it('process editor format rules round-trip under their key', async () => {
    const cfg = { ...loadFormatConfig(URL), keywordCase: 'lower' as const };
    await saveFormatConfig(URL, cfg);
    expect(gs.has(FORMAT_CONFIG_KEY)).toBe(true);
    expect(loadFormatConfig(URL).keywordCase).toBe('lower');
  });

  it('rule editor format rules have their OWN key', async () => {
    // `RuleFormatConfig` is a DIFFERENT shape from `TiFormatConfig` — there is
    // no `keywordCase`, only `enabled` and `parenStyle`.
    const cfg = { ...loadRuleFormatConfig(URL), parenStyle: 'spaced' as const };
    await saveRuleFormatConfig(URL, cfg);
    expect(gs.has(RULE_FORMAT_CONFIG_KEY)).toBe(true);
    // The easily confused neighbour must not get anything — the two modules
    // are identical line for line and differ only in the key.
    expect(gs.has(FORMAT_CONFIG_KEY)).toBe(false);
    expect(loadRuleFormatConfig(URL).parenStyle).toBe('spaced');
  });

  it('exceptions of the value name check are normalised on WRITE', async () => {
    await saveExcludes(URL, ['  Wert  ', '', 'Wert']);
    const abgelegt = (gs.get(VALUE_NAMING_EXCLUDES_KEY) as Record<string, string[]>)[URL];
    expect(abgelegt).not.toContain('');
    expect(abgelegt).not.toContain('  Wert  ');
    expect(loadExcludes(URL)).toEqual(abgelegt);
  });

  it('attribute columns separate server and dimension in the key', async () => {
    await saveAttrColumns(ctx, 'srv-1', 'Region', ['Alias'], { Alias: 120 });
    await saveAttrColumns(ctx, 'srv-2', 'Region', ['Caption'], {});
    expect(loadAttrColumns(ctx, 'srv-1', 'Region')).toEqual({ cols: ['Alias'], widths: { Alias: 120 } });
    expect(loadAttrColumns(ctx, 'srv-2', 'Region')).toEqual({ cols: ['Caption'], widths: {} });

    // An empty selection deletes the entry instead of storing an empty value.
    await saveAttrColumns(ctx, 'srv-1', 'Region', [], {});
    expect(gs.get(ATTRCOL_STATE_KEY)).toEqual({
      [`${encodeURIComponent('srv-2')}::${encodeURIComponent('Region')}`]: { cols: ['Caption'], widths: {} },
    });

    expect(await purgeAttrColumnsForServer(ctx, 'srv-2')).toBe(1);
    expect(gs.get(ATTRCOL_STATE_KEY)).toEqual({});
    expect(await purgeAttrColumnsForServer(ctx, 'srv-2')).toBe(0);
  });

  it('attribute columns: a colon in the name does not shift the key', async () => {
    // `'s::a' + 'b'` and `'s' + 'a::b'` must not land on the same key —
    // hence `encodeURIComponent` BEFORE joining.
    await saveAttrColumns(ctx, 's::a', 'b', ['x'], {});
    await saveAttrColumns(ctx, 's', 'a::b', ['y'], {});
    expect(loadAttrColumns(ctx, 's::a', 'b').cols).toEqual(['x']);
    expect(loadAttrColumns(ctx, 's', 'a::b').cols).toEqual(['y']);
  });
});
