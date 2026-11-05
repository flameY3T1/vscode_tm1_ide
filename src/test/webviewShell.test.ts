import { describe, it, expect } from 'vitest';
import { renderWebviewShell, setUiLanguage } from '../webviews/webviewShell';

const CSP_SOURCE = 'vscode-resource://test';

describe('renderWebviewShell', () => {
  it('renders minimal shell with standard CSP and generated nonce', () => {
    const html = renderWebviewShell({ cspSource: CSP_SOURCE, body: '<div id="app"></div>' });
    const nonceMatch = html.match(/script-src 'nonce-([0-9a-f]{32})'/);
    expect(nonceMatch).not.toBeNull();
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain(`style-src ${CSP_SOURCE} 'unsafe-inline'`);
    expect(html).toContain(`font-src ${CSP_SOURCE} data:`);
    expect(html).toContain(`img-src ${CSP_SOURCE} data:`);
    // Without `lang` the UI language applies, set on activation
    // (`setUiLanguage`); without a call it stays `en` — previously hard-coded `de`, which
    // gave every English UI a German screen-reader language (B17).
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<div id="app"></div>');
    expect(html).not.toContain('<title>');
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('viewport');
  });

  it('uses injected nonce for script tags and CSP', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      nonce: 'abc123',
      scriptUris: ['https://x/main.js'],
    });
    expect(html).toContain(`script-src 'nonce-abc123'`);
    expect(html).toContain('<script nonce="abc123" src="https://x/main.js"></script>');
  });

  it('setUiLanguage sets the default for all shells, an explicit lang overrides it', () => {
    setUiLanguage('de-DE');
    expect(renderWebviewShell({ cspSource: 'vscode-webview:', body: '' }))
      .toContain('<html lang="de-DE">');
    expect(renderWebviewShell({ cspSource: 'vscode-webview:', body: '', lang: 'fr' }))
      .toContain('<html lang="fr">');
    setUiLanguage('en');
  });

  it('renders title, lang, viewport, inline css and link stylesheets in head order', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      lang: 'en',
      title: 'My Panel',
      viewport: true,
      styleUris: ['https://x/vendor.css'],
      css: 'body { margin: 0; }',
    });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>My Panel</title>');
    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1.0">');
    const linkIdx = html.indexOf('<link rel="stylesheet" href="https://x/vendor.css">');
    const styleIdx = html.indexOf('<style>body { margin: 0; }</style>');
    expect(linkIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(linkIdx);
  });

  it('emits globals as JSON in a nonced inline script', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      nonce: 'n1',
      globals: { __tm1Vendor: 'https://x/v.js', __tm1Flag: true },
    });
    expect(html).toContain('window.__tm1Vendor = "https://x/v.js";');
    expect(html).toContain('window.__tm1Flag = true;');
    expect(html).toMatch(/<script nonce="n1">\n\s+window\.__tm1Vendor/);
  });

  it('exposeNonce adds window.__tm1Nonce even without other globals', () => {
    const html = renderWebviewShell({ cspSource: CSP_SOURCE, body: 'b', nonce: 'n2', exposeNonce: true });
    expect(html).toContain('window.__tm1Nonce = "n2";');
  });

  it('omits inline script when no globals and no exposeNonce', () => {
    const html = renderWebviewShell({ cspSource: CSP_SOURCE, body: 'b', nonce: 'n3', scriptUris: ['s.js'] });
    expect(html).not.toContain('window.');
    expect(html).toContain('<script nonce="n3" src="s.js"></script>');
  });

  it('renders jsonData blocks before globals and bundle scripts', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      nonce: 'n4',
      jsonData: [{ id: 'sig-data', json: '{"a":1}' }],
      globals: { __g: 1 },
      scriptUris: ['vendor.js', 'main.js'],
    });
    const jsonIdx = html.indexOf('<script type="application/json" id="sig-data" nonce="n4">{"a":1}</script>');
    const globalsIdx = html.indexOf('window.__g = 1;');
    const vendorIdx = html.indexOf('<script nonce="n4" src="vendor.js"></script>');
    const mainIdx = html.indexOf('<script nonce="n4" src="main.js"></script>');
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(globalsIdx).toBeGreaterThan(jsonIdx);
    expect(vendorIdx).toBeGreaterThan(globalsIdx);
    expect(mainIdx).toBeGreaterThan(vendorIdx);
  });

  it('escapes </script> breakout and line separators in global values', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      nonce: 'n6',
      globals: { __x: '</script><script>alert(1)</script>', __y: 'a b c' },
    });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('a\\u2028b\\u2029c');
  });

  it('escapes </script> breakout in jsonData blocks', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: 'b',
      nonce: 'n7',
      jsonData: [{ id: 'd', json: '{"a":"</script><script>alert(1)</script>"}' }],
    });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });

  it('keeps body before scripts inside <body>', () => {
    const html = renderWebviewShell({
      cspSource: CSP_SOURCE,
      body: '<main>content</main>',
      nonce: 'n5',
      scriptUris: ['s.js'],
    });
    const bodyIdx = html.indexOf('<main>content</main>');
    const scriptIdx = html.indexOf('<script nonce="n5" src="s.js">');
    expect(bodyIdx).toBeGreaterThan(html.indexOf('<body>'));
    expect(scriptIdx).toBeGreaterThan(bodyIdx);
    expect(html.indexOf('</body>')).toBeGreaterThan(scriptIdx);
  });
});
