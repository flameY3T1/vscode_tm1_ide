/**
 * Webview environment pieces the Monaco editors (process, rule, MDX runner)
 * all need.
 */

/** Suppress Monaco's web-worker warnings — no real worker in the webview; our languages don't need one. */
export function stubMonacoWorkers(): void {
  (self as any).MonacoEnvironment = {
    getWorker: () => ({
      postMessage: () => { /* noop */ },
      terminate: () => { /* noop */ },
      onmessage: null,
      addEventListener: () => { /* noop */ },
      removeEventListener: () => { /* noop */ },
    }),
  };
}

/**
 * External-link proxy: Monaco opens hover/completion Markdown links via
 * `window.open(url,'_blank')`, and the webview iframe blocks it; plain
 * `<a href>` clicks go nowhere either. Both are routed to `openExternal`,
 * which posts the URL to the extension. Only http(s) URLs are taken.
 */
export function installExternalLinkProxy(openExternal: (url: string) => void): void {
  const origOpen = window.open.bind(window);
  (window as any).open = (url?: string | URL, target?: string, features?: string) => {
    const u = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : '');
    if (u && /^https?:\/\//i.test(u)) {
      openExternal(u);
      return null;
    }
    return origOpen(url as any, target, features);
  };

  document.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) { return; }
    const a = t.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) { return; }
    const href = a.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) { return; }
    e.preventDefault();
    e.stopPropagation();
    openExternal(href);
  }, true);
}
