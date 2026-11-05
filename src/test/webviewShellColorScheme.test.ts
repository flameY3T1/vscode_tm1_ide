/**
 * Reported 2026-08-30: in the new-process wizard the dropdown list after the
 * cube or dimension choice was white, in the dark theme.
 *
 * The cause is not the page's stylesheet. The native popup windows
 * (dropdown list of a select, suggestion list of a datalist, date picker,
 * scrollbars) are painted by the renderer according to `color-scheme` — author styles
 * do not reach them. That is why an `option` rule did not help.
 *
 * Four webviews brought the binding along by hand, the remaining thirty or so
 * did not. It belongs in the shell, so that the question is not answered anew
 * for each window.
 */
import { describe, it, expect } from 'vitest';
import { renderWebviewShell } from '../webviews/webviewShell';

describe('Webview shell — color scheme', () => {
  const html = renderWebviewShell({ cspSource: 'vscode-webview:', body: '' });

  it('binds color-scheme to the VS Code theme', () => {
    expect(html).toContain('body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }');
    expect(html).toContain('body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }');
  });

  it('not "light dark" — that asked the operating system instead of the theme', () => {
    expect(html).not.toContain('color-scheme: light dark');
  });

  it('comes before the caller\'s stylesheet, so that it can override it', () => {
    const withCss = renderWebviewShell({ cspSource: 'vscode-webview:', body: '', css: '.x{color:red}' });
    expect(withCss.indexOf('color-scheme: dark')).toBeLessThan(withCss.indexOf('.x{color:red}'));
  });
});
