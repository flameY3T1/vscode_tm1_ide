// Transient toast in the `error-banner` div (auto-hides after 2.5s).
// window.alert is blocked in webview sandboxes, so any user-facing hint from
// the Dimension Browser client routes through here. Shared by msg.ts (MDX /
// drill feedback) and subset.ts (collapse-all filter-cleared hint).

export {};

export function flashBanner(text: string): void {
  const el = document.getElementById('error-banner') as HTMLElement | null;
  if (!el) { return; }
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(function () { el.style.display = 'none'; }, 2500);
}
