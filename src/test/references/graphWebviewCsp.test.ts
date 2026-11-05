import { describe, it, expect } from 'vitest';
import { getUsageGraphHtml } from '../../references/usageGraphWebview';
import { getCallGraphHtml } from '../../references/callGraphWebview';
import { getChoreGraphHtml } from '../../references/choreGraphWebview';
import type { CallGraphNode } from '../../references/callGraph';
import * as vscode from 'vscode';

// A webview stub, so the pages emit their bundle tag.
const opts = {
  webview: { cspSource: 'csp:', asWebviewUri: (u: unknown) => u } as unknown as vscode.Webview,
  extensionUri: vscode.Uri.file('/ext'),
};

const callRoot: CallGraphNode = {
  process: 'P',
  children: [],
  env: new Map(),
} as unknown as CallGraphNode;

const cases: [string, () => string][] = [
  ['usageGraph', () => getUsageGraphHtml('dimension', 'Region', [], opts)],
  ['callGraph', () => getCallGraphHtml(callRoot, 'downstream', 'P', undefined, opts)],
  ['choreGraph', () => getChoreGraphHtml({ choreName: 'C', tasks: [] }, opts)],
];

describe('reference graph webviews — CSP/nonce shell', () => {
  for (const [name, render] of cases) {
    it(`${name}: emits a Content-Security-Policy meta`, () => {
      const html = render();
      expect(html).toContain('http-equiv="Content-Security-Policy"');
    });

    it(`${name}: script-src is nonce-only (no unsafe-inline)`, () => {
      const html = render();
      const csp = html.match(/content="([^"]*)"/)?.[1] ?? '';
      const scriptSrc = csp.split(';').find(p => p.trim().startsWith('script-src')) ?? '';
      expect(scriptSrc).toContain('nonce-');
      expect(scriptSrc).not.toContain('unsafe-inline');
    });

    it(`${name}: loads its bundle with a nonce, no inline page script`, () => {
      const html = render();
      expect(html).toMatch(new RegExp(`<script nonce="[^"]+" src="/ext/out/webview/${name}\\.js"></script>`));
      expect(html).not.toContain('acquireVsCodeApi');
    });
  }
});
