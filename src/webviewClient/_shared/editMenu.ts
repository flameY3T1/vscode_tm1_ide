/**
 * "Code actions" toolbar dropdown of the process and rule editor: indent /
 * outdent / comment / uncomment. The rows (icon + label + shortcut) are
 * rendered statically in the webview HTML (webviews/monacoEditorChrome.ts
 * editMenuHtml) so they can use the extension's SVG icon URIs; this wires each
 * row's `data-action` to the matching Monaco action and handles toggle +
 * outside-click-close (reuses the `.format-menu` popup).
 */
import type * as monacoType from 'monaco-editor';

/**
 * Toggle the dropdown; run a row's Monaco action on click. The menu stays open
 * on row-click so repeatable actions (indent/outdent) can be pressed multiple
 * times; it closes only on an outside click.
 */
export function initEditMenu(editor: monacoType.editor.IStandaloneCodeEditor): void {
  const btn = document.getElementById('btn-edit-menu');
  const menu = document.getElementById('edit-menu');
  if (!btn || !menu) { return; }
  const close = (): void => { menu.hidden = true; };

  menu.querySelectorAll<HTMLButtonElement>('button.act').forEach((row) => {
    row.addEventListener('click', () => {
      const action = row.dataset.action;
      // Keep the menu open (no close()) so indent/outdent can be repeated;
      // outside-click still closes it.
      if (action) { void editor.getAction(action)?.run(); editor.focus(); }
    });
  });

  btn.addEventListener('click', () => {
    if (menu.hidden) {
      const r = btn.getBoundingClientRect();
      menu.style.left = `${r.left}px`;
      menu.style.top = `${r.bottom + 2}px`;
      menu.hidden = false;
    } else {
      close();
    }
  });
  // btn contains <img> children, so guard on containment (not identity) —
  // otherwise clicking the button's icon would immediately re-close the menu.
  document.addEventListener('click', (e) => {
    const t = e.target as Node;
    if (!menu.hidden && !btn.contains(t) && !menu.contains(t)) { close(); }
  });
}
