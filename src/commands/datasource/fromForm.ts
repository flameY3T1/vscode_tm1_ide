/**
 * Wizard form values (plain strings/booleans off a webview) → `DatasourceConfig`.
 *
 * Leaf module on purpose: no vscode, no REST, and NOT reached through the
 * `datasource/index.ts` barrel — that one pulls in `fetch.ts` and with it vscode,
 * which would make `*Pure.ts` importers impure (`pure-no-vscode`).
 *
 * Both wizards (new process, edit datasource) used to rebuild this config field
 * by field in their own message handler. That is how `odbcPassword` and
 * `usesUnicode` went missing on the way from the form to the payload: the webview
 * collected them and the payload builder read them, but nothing in between
 * carried them. One list, unit-tested, for both callers.
 */

import type { DatasourceConfig } from './types';

export function toDatasourceConfig(
  v: Record<string, unknown>,
  defaults: DatasourceConfig,
): DatasourceConfig {
  const str = (key: string, fallback = ''): string => {
    const raw = v[key];
    return raw === undefined || raw === null ? fallback : String(raw);
  };
  return {
    ...defaults,
    type: (str('dsType', 'NULL') || 'NULL') as DatasourceConfig['type'],
    datasourceName: str('datasourceName'),
    viewSubsetName: str('viewSubsetName'),
    odbcUsername: str('odbcUsername'),
    odbcPassword: str('odbcPassword'),
    // Left undefined when the form sends nothing, so the value already on the
    // server (or in the .pro file) survives instead of being forced to `false`.
    usesUnicode: typeof v.usesUnicode === 'boolean' ? v.usesUnicode : undefined,
    sqlQuery: str('sqlQuery'),
    delimiter: str('delimiter', ','),
    quoteChar: str('quoteChar', '"'),
    decimalSep: str('decimalSep', '.'),
    thousandSep: str('thousandSep', ','),
    titleRows: parseInt(str('titleRows', '0'), 10) || 0,
  };
}
