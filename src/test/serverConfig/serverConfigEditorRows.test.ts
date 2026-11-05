import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../commands/serverConfig/serverConfigEditorWebview';
import type { ConfigSnapshot } from '../../serverConfig/configApi';

describe('serverConfigEditorWebview#renderHtml — dedup nested-vs-root duplicate paths', () => {
  it('does not render ServerName twice when the server exposes it at root AND under Administration', () => {
    // Live 11.8 measurement: `paths` legitimately contains BOTH "ServerName" (root)
    // and "Administration.ServerName" (nested) for the same tm1s.cfg setting — this is
    // exactly the case `resolveWritePath` already prefers root for on the write side.
    const snap: ConfigSnapshot = {
      values: new Map<string, unknown>([
        ['ServerName', 'Planning Sample'],
        ['Administration.ServerName', 'Planning Sample'],
      ]),
      staticKeys: new Set(['ServerName', 'Administration.ServerName']),
      activeKeys: new Set(),
      paths: new Set(['ServerName', 'Administration.ServerName']),
    };

    const html = renderHtml(snap, 'My Server');

    // Row data ships to the client in the `window.__serverConfig` globals JSON
    // (the bundle builds the actual DOM at runtime) — assert against that, not markup.
    expect((html.match(/"name":"ServerName"/g) ?? []).length).toBe(1);
    expect(html).not.toContain('"name":"Administration.ServerName"');
  });
});
