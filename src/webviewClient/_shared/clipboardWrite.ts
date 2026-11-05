// Clipboard write for webview bundles. `navigator.clipboard` is missing in
// older webview contexts and may refuse permission; a hidden textarea plus
// `execCommand('copy')` is the way that always works. Seven call sites carried
// their own copy, and only some fell back after a rejected write (review
// 2026-10-03, B6).

type NavClip = Navigator & { clipboard?: { writeText?: (s: string) => Promise<void> } };

/** Resolves `true` once one of the two ways copied the text. Feedback is the caller's. */
export async function writeClipboard(text: string): Promise<boolean> {
  const nav = navigator as NavClip;
  if (nav.clipboard?.writeText) {
    try { await nav.clipboard.writeText(text); return true; }
    catch { /* permission denied: try the textarea */ }
  }
  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nothing else to try */ }
  ta.remove();
  return ok;
}
