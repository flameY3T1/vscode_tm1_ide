import { getDebugVariables, isDebugging, isDebugPaused } from './debug';
import { vscode } from './state';
import { getL10n } from '../_shared/l10n';
import {
  filterVarsByName,
  sortPinnedThenChanged,
  clampWidth,
} from './debugVarsPanelPure';
import { changedNamesForBreak } from './debugVarsDiff';
import { escapeHtml } from '../htmlUtils';

const MIN_W = 180;
const MAX_W = 600;
const DEFAULT_W = 300;
const STATE_KEY = 'debugVarsWidth';
const PINNED_KEY = 'debugVarsPinned';

let panel: HTMLElement | null = null;
let resizer: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let filterEl: HTMLInputElement | null = null;
let bodyEl: HTMLElement | null = null;
let unpinAllEl: HTMLElement | null = null;

let filterQuery = '';

/**
 * Pinned variables of this editor.
 *
 * Lives in the webview state (`vscode.setState`), not in the extension: the
 * panel belongs to exactly one process, so the state survives debug runs
 * and the window being hidden without a single message going over to the host.
 * It is gone when the editor is closed — agreed that way ("when in doubt, clear"),
 * and storing it in the extension would drag in server-related storage plus
 * cleanup when the profile is deleted (see `stateKeys.ts`).
 */
let pinned = new Set<string>();

function loadPinned(): Set<string> {
  const st = (vscode.getState() as { [k: string]: unknown } | undefined) ?? {};
  const raw = st[PINNED_KEY];
  return new Set(Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string') : []);
}

function persistPinned(): void {
  const st = (vscode.getState() as { [k: string]: unknown } | undefined) ?? {};
  vscode.setState({ ...st, [PINNED_KEY]: [...pinned] });
}

const esc = (s: unknown): string => escapeHtml(s ?? '');

function savedWidth(): number {
  const st = (vscode.getState() as { [k: string]: unknown } | undefined) ?? {};
  const w = Number(st[STATE_KEY]);
  return Number.isFinite(w) && w > 0 ? clampWidth(w, MIN_W, MAX_W) : DEFAULT_W;
}

function persistWidth(w: number): void {
  const st = (vscode.getState() as { [k: string]: unknown } | undefined) ?? {};
  vscode.setState({ ...st, [STATE_KEY]: w });
}

function applyWidth(w: number): void {
  if (panel) { panel.style.width = w + 'px'; }
}

export function initDebugVarsPanel(): void {
  panel = document.getElementById('debug-vars-panel');
  resizer = document.getElementById('debug-vars-resizer');
  countEl = document.getElementById('debug-vars-count');
  filterEl = document.getElementById('debug-vars-filter') as HTMLInputElement | null;
  bodyEl = document.getElementById('debug-vars-body');
  unpinAllEl = document.getElementById('debug-vars-unpin-all');
  if (!panel) { return; }

  applyWidth(savedWidth());
  pinned = loadPinned();

  // One listener on the body instead of one per row: the table is rewritten completely
  // on every stop, so listeners attached individually would be gone each time
  // and would have to be re-attached each time.
  bodyEl?.addEventListener('click', (ev: MouseEvent) => {
    const cell = (ev.target as HTMLElement | null)?.closest('.dv-pin');
    const name = cell?.getAttribute('data-var');
    if (!name) { return; }
    if (pinned.has(name)) { pinned.delete(name); } else { pinned.add(name); }
    persistPinned();
    renderDebugVarsPanel();
  });

  unpinAllEl?.addEventListener('click', () => {
    if (pinned.size === 0) { return; }
    pinned.clear();
    persistPinned();
    renderDebugVarsPanel();
  });

  filterEl?.addEventListener('input', () => {
    filterQuery = filterEl!.value;
    renderDebugVarsPanel();
  });

  // Drag-to-resize. Panel is docked right, so wider = drag left (smaller clientX).
  resizer?.addEventListener('mousedown', (down: MouseEvent) => {
    down.preventDefault();
    const startX = down.clientX;
    const startW = panel!.getBoundingClientRect().width;
    const onMove = (mv: MouseEvent) => {
      const next = clampWidth(startW + (startX - mv.clientX), MIN_W, MAX_W);
      applyWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistWidth(panel!.getBoundingClientRect().width);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function renderDebugVarsPanel(): void {
  if (!panel) { return; }
  const debugging = isDebugging();
  document.body.classList.toggle('debugging', debugging);
  if (!debugging) { return; }

  const paused = isDebugPaused();
  panel.classList.toggle('running', !paused);

  const all = getDebugVariables();
  const l10n = getL10n();

  // Built once per STOP, not per render — see debugVarsDiff.ts.
  const changed = changedNamesForBreak(all, paused);

  // Filter, then pinned ones to the very top and the changed ones after them.
  const visible = sortPinnedThenChanged(filterVarsByName(all, filterQuery), pinned, changed);

  // The button appears only when there is something to release: a narrow
  // header row has no room for a button that never does anything.
  if (unpinAllEl) { unpinAllEl.hidden = pinned.size === 0; }

  // Count badge: "visible / total" when filtering, else just total.
  if (countEl) {
    countEl.textContent = filterQuery.trim() === ''
      ? String(all.length)
      : visible.length + ' / ' + all.length;
  }

  if (bodyEl) {
    if (all.length === 0) {
      const msg = paused
        ? (l10n['debugVarsEmpty'] ?? 'No variables')
        : (l10n['debugVarsWaiting'] ?? 'Waiting for breakpoint…');
      bodyEl.innerHTML = '<div class="dv-empty">' + esc(msg) + '</div>';
    } else if (visible.length === 0) {
      bodyEl.innerHTML = '<div class="dv-empty">' + esc(l10n['debugVarsNoMatch'] ?? 'No match') + '</div>';
    } else {
      const rows = visible.map(v => {
        const isPinned = pinned.has(v.name);
        const cls = [changed.has(v.name) ? 'changed' : '', isPinned ? 'pinned' : ''].filter(Boolean).join(' ');
        const trCls = cls ? ' class="' + cls + '"' : '';
        const pinTitle = isPinned
          ? (l10n['debugVarsUnpin'] ?? 'Unpin')
          : (l10n['debugVarsPin'] ?? 'Pin to top');
        return '<tr' + trCls + '><td class="dv-pin" data-var="' + esc(v.name) +
          '" title="' + esc(pinTitle) + '">' + (isPinned ? '\u2691' : '') +
          '</td><td class="dv-name">' + esc(v.name) +
          '</td><td class="dv-value">' + esc(v.value) + '</td></tr>';
      }).join('');
      bodyEl.innerHTML = '<table class="dv-table"><tbody>' + rows + '</tbody></table>';
    }
  }
}
