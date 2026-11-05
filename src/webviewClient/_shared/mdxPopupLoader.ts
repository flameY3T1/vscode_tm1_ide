// src/webviewClient/_shared/mdxPopupLoader.ts
//
// Lazy loader for the shared MDX popup bundle (`mdxPopupEditor`, ~4 MB Monaco).
// Cube Viewer and Dimension Browser both open the same popup and used to carry
// identical copies of this loader. The bundle is only fetched on the first
// open, so neither webview pays for it at start.
//
// The host injects the URIs as window globals (`__tm1MdxPopupBundle`, ...);
// without `__tm1MdxPopupBundle` there is no editor and callers fall back to
// the plain textarea.

/** What `mdxPopupEditor/index.ts` puts on `window.mdxPopupEditor`. */
export interface MdxPopupEditorApi {
  init(container: HTMLElement, initialValue: string): void;
  getValue(): string;
  layout(): void;
}

type PopupWindow = Window & {
  mdxPopupEditor?: MdxPopupEditorApi;
  __tm1MdxPopupBundle?: string;
  __tm1MdxPopupCss?: string;
  __tm1MonacoVendor?: string;
  __tm1Nonce?: string;
  monaco?: unknown;
};

const w = (): PopupWindow => window as PopupWindow;

let loading: Promise<MdxPopupEditorApi | null> | null = null;

/** True when the host shipped the popup bundle (otherwise: textarea only). */
export function hasMdxPopupBundle(): boolean {
  return !!w().__tm1MdxPopupBundle;
}

/** The popup editor, if its bundle has already been loaded. */
export function loadedMdxPopupEditor(): MdxPopupEditorApi | undefined {
  return w().mdxPopupEditor;
}

function loadScript(src: string, nonce: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    if (nonce) { s.setAttribute('nonce', nonce); }
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Load CSS, Monaco vendor and the popup bundle once; null if anything fails. */
export function loadMdxPopupEditor(): Promise<MdxPopupEditorApi | null> {
  const win = w();
  if (win.mdxPopupEditor) { return Promise.resolve(win.mdxPopupEditor); }
  if (loading) { return loading; }
  const bundleUri = win.__tm1MdxPopupBundle;
  const cssUri = win.__tm1MdxPopupCss;
  const vendorUri = win.__tm1MonacoVendor;
  const nonce = win.__tm1Nonce;
  if (!bundleUri) { return Promise.resolve(null); }
  // CSS first (Monaco needs its sheet before mounting), then vendor JS, then editor bundle.
  if (cssUri && !document.querySelector('link[data-tm1-mdx-popup]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUri;
    link.setAttribute('data-tm1-mdx-popup', '1');
    document.head.appendChild(link);
  }
  loading = (async () => {
    if (!win.monaco && vendorUri) {
      const ok = await loadScript(vendorUri, nonce);
      if (!ok || !win.monaco) { loading = null; return null; }
    }
    const loaded = await loadScript(bundleUri, nonce);
    if (!loaded) { loading = null; return null; }
    return w().mdxPopupEditor ?? null;
  })();
  return loading;
}
