/**
 * Minimal generic right-click context menu for the Dimension Editor tree.
 *
 * The Dimension *Browser* has its own static-HTML ctx-menu with fixed drill
 * actions; the editor only needs a couple of dynamic per-row actions, so this
 * is a tiny self-contained builder — no shell markup, inline theme-var styles,
 * one menu at a time, dismissed on outside click / Escape / blur.
 */

export interface ContextMenuItem {
  label?: string;
  danger?: boolean;
  /** Render a thin divider instead of a clickable row. */
  separator?: boolean;
  /** Greyed out and not clickable. Needs `title`, otherwise the reason stays invisible. */
  disabled?: boolean;
  /** Tooltip — for `disabled`, the reason. */
  title?: string;
  onClick?: () => void;
}

let _menu: HTMLElement | null = null;

function _dismiss(): void {
  if (_menu) { _menu.remove(); _menu = null; }
  document.removeEventListener('click', _onDocClick, true);
  document.removeEventListener('contextmenu', _onDocClick, true);
  document.removeEventListener('keydown', _onKey, true);
  window.removeEventListener('blur', _dismiss);
}

function _onDocClick(): void { _dismiss(); }
function _onKey(e: KeyboardEvent): void { if (e.key === 'Escape') { _dismiss(); } }

/** Show a context menu at viewport coords `(x, y)`. No-op for an empty item list. */
export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  _dismiss();
  if (!items.length) { return; }

  const menu = document.createElement('div');
  menu.className = 'dim-context-menu';
  menu.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'min-width:180px',
    'padding:4px 0',
    'background:var(--vscode-menu-background, var(--vscode-editor-background))',
    'color:var(--vscode-menu-foreground, var(--vscode-editor-foreground))',
    'border:1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(128,128,128,0.35)))',
    'border-radius:4px',
    'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
    'font-size:13px',
    'user-select:none',
  ].join(';');

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;margin:4px 0;background:var(--vscode-menu-separatorBackground, var(--vscode-widget-border, rgba(128,128,128,0.35)))';
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.textContent = item.label ?? '';
    row.style.cssText = 'padding:5px 14px;white-space:nowrap;'
      + (item.disabled ? 'cursor:default;opacity:0.5' : 'cursor:pointer');
    if (item.title) { row.title = item.title; }
    const baseColor = item.danger ? 'var(--vscode-errorForeground, #e51400)' : '';
    if (baseColor) { row.style.color = baseColor; }
    row.onmouseenter = () => {
      if (item.disabled) { return; }
      row.style.background = 'var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground))';
      if (!item.danger) { row.style.color = 'var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground))'; }
    };
    row.onmouseleave = () => {
      row.style.background = 'transparent';
      if (!item.danger) { row.style.color = ''; }
    };
    row.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      // A disabled entry does NOT close the menu — otherwise the
      // reason disappears at the very moment the user is looking for it.
      if (item.disabled) { return; }
      _dismiss();
      item.onClick?.();
    };
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // Clamp inside the viewport.
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let px = x, py = y;
  if (px + mw > window.innerWidth) { px = Math.max(4, window.innerWidth - mw - 6); }
  if (py + mh > window.innerHeight) { py = Math.max(4, window.innerHeight - mh - 6); }
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  _menu = menu;

  // Defer listener attach so the current right-click's trailing events don't
  // immediately dismiss the menu we just opened.
  setTimeout(() => {
    document.addEventListener('click', _onDocClick, true);
    document.addEventListener('contextmenu', _onDocClick, true);
    document.addEventListener('keydown', _onKey, true);
    window.addEventListener('blur', _dismiss);
  }, 0);
}
