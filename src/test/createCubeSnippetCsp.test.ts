// The create-cube dialog and the snippet editor were the last two panels built
// without renderWebviewShell, so they had no CSP and a nonce-less script.
import { it, expect } from 'vitest';
import { getCreateCubeHtml } from '../commands/cubeViewer/createCube';
import { getSnippetEditorHtml } from '../snippets/snippetEditorWebview';
it('both pages carry CSP and a parseable nonced script', () => {
  for (const html of [getCreateCubeHtml(['A', 'B'], 'csp:', 'bundle.js'), getSnippetEditorHtml(null, 'csp:', 'bundle.js'), getSnippetEditorHtml({ id: 'x', trigger: 't', name: 'n', description: '', servers: '', body: 'b' } as never, 'csp:', 'bundle.js')]) {
    expect(html).toContain('Content-Security-Policy');
    const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    // One nonce'd globals script; the page logic is a nonce'd bundle tag (2026-10).
    expect(scripts.length).toBe(1);
    expect(() => new Function(scripts[0])).not.toThrow();
    expect(html).toMatch(/<script nonce="[^"]+" src="bundle\.js"><\/script>/);
    expect(html).not.toMatch(/<script>/);
  }
});
