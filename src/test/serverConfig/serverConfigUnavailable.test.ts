import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../commands/serverConfig/serverConfigEditorWebview';
import type { ConfigSnapshot } from '../../serverConfig/configApi';

/**
 * Which params a server accepts is read off the server, never off a hardcoded version list.
 * Measured 2026-08-09: /StaticConfiguration carries 158 leaves on 11.8 against 64 on v12
 * (no Access group at all — ports, SSL, CAM and LDAP are gone). At the same time v12 still
 * exposes CacheFriendlyMalloc, DisableMemoryCache, LockPagesInMemory and
 * ApplyMaximumViewSizeToEntireTransaction, all four of which IBM lists as removed in TM1 12.
 * A version table would be wrong in both directions; the snapshot is not.
 *
 * The rows are rendered in the webview, so the assertions read the embedded row data.
 */
function snapshot(paths: string[], values: Array<[string, unknown]> = []): ConfigSnapshot {
  return {
    values: new Map(values),
    staticKeys: new Set(paths),
    activeKeys: new Set(),
    paths: new Set(paths),
  };
}

function rowsOf(html: string): Array<{ name: string; unavailable: boolean; readonly: boolean; value: unknown; description: string }> {
  const m = /window\.__serverConfig = (.*);\n/.exec(html);
  if (!m) { throw new Error('no __serverConfig payload in the rendered html'); }
  return JSON.parse(m[1]).rows;
}

function row(html: string, name: string) {
  const r = rowsOf(html).find(x => x.name === name);
  if (!r) { throw new Error(`no row for ${name}`); }
  return r;
}

describe('server config editor — params the server does not know', () => {
  it('marks a schema param the server has no leaf for', () => {
    // PortNumber lands under Access.CAPI.Port on 11.8 — v12 has no Access group.
    const html = renderHtml(snapshot(['Administration.Language']), 'v12box');
    expect(row(html, 'PortNumber').unavailable).toBe(true);
  });

  it('shows the leaf, not the old tm1.cfg name, when the server has it', () => {
    const html = renderHtml(snapshot(['Access.CAPI.Port', 'Administration.Language']), 'v11box');
    expect(row(html, 'Access.CAPI.Port').unavailable).toBe(false);
    // Two editors writing Access.CAPI.Port would be one too many.
    expect(rowsOf(html).some(r => r.name === 'PortNumber')).toBe(false);
  });

  it('lists a leaf the server has but has not set', () => {
    // The whole point: `values` carries configured params only, so an unset one would
    // otherwise be invisible — and that is the one someone opens the editor to set.
    const html = renderHtml(snapshot(['Administration.LegacyTransactionLog']), 'v12box');
    expect(row(html, 'Administration.LegacyTransactionLog').unavailable).toBe(false);
  });

  it('keeps every row editable when the server exposed no paths at all', () => {
    // Neither nested endpoint answered: no knowledge is not the same as "not supported".
    const html = renderHtml(snapshot([]), 'oldbox');
    expect(rowsOf(html).some(r => r.unavailable)).toBe(false);
  });
});

/**
 * "Not writable" and "does not exist here" are two different situations, and until
 * 2026-08-31 both carried the same label N/A.
 *
 * The flat keys of the old `/Configuration` view have a value,
 * but accept no PATCH. Measured on 11.8 on 2026-08-31: all six sent
 * their OWN value, all six returned `400 Code 278 Invalid ServerSettings
 * property encountered in payload`. So they are read-only, not absent.
 */
describe('server config editor — read-only is not the same as absent', () => {
  it('marks a legacy flat key with a value as read-only, not N/A', () => {
    const html = renderHtml(snapshot(['Administration.Language'], [['SecurityMode', 'Basic']]), 'srv');
    const r = rowsOf(html).find(x => x.name === 'SecurityMode')!;
    expect(r.value).toBe('Basic');
    expect(r.readonly).toBe(true);
    expect(r.unavailable).toBe(false);
    expect(r.description).not.toContain('unknown parameter');
  });

  it('keeps N/A for a param the server has neither a value nor a leaf for', () => {
    const r = rowsOf(renderHtml(snapshot(['Administration.Language']), 'v12box')).find(x => x.name === 'PortNumber')!;
    expect(r.value).toBeUndefined();
    expect(r.unavailable).toBe(true);
  });

  // A value next to "does not exist here" is a contradiction — it must not appear in
  // any row.
  it('never shows a value on a row marked N/A', () => {
    const html = renderHtml(snapshot(
      ['Administration.Language'],
      [['SecurityMode', 'Basic'], ['ProductVersion', '11.8.02900.8'], ['WebCAMURI', '']],
    ), 'srv');
    expect(rowsOf(html).filter(r => r.unavailable && r.value !== undefined)).toEqual([]);
  });
});
