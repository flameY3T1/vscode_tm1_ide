// src/webviewClient/securityElement/index.ts
// Thin adapter — render + event glue lives in _shared/securityMatrixCore.
// Element-only: the missing-cube banner with its "Create" button and the
// dimension name in the heading.
import type { HostToWebview, WebviewToHost } from './protocol';
import type { ElementPermLevel } from '../../security/types/permission';
import { LEVELS_PER_RESOURCE } from '../../security/core/permLevels';
import { runSecurityMatrix, type MatrixChange } from '../_shared/securityMatrixCore';
import { getL10n, fmt } from '../_shared/l10n';
import { escapeHtml } from '../htmlUtils';

const L = getL10n();

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`Missing #${id}`); }
  return el;
}

runSecurityMatrix<ElementPermLevel>({
  entityLabel: 'Element',
  entityLabelPlural: 'elements',
  levels: LEVELS_PER_RESOURCE.element as readonly ElementPermLevel[],

  parseInit(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'init') { return null; }
    return { rows: m.elements, groups: m.groups, perms: m.perms };
  },

  parseRefresh(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'refreshed') { return null; }
    return m.perms;
  },

  parseSaved(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'saved') { return null; }
    return {
      ok: m.ok.map(o => ({ row: o.element, group: o.group })),
      errors: m.errors.map(e => ({ row: e.element, group: e.group, reason: e.reason })),
    };
  },

  buildSaveMsg(changes: Array<MatrixChange<ElementPermLevel>>): WebviewToHost {
    return {
      type: 'save',
      changes: changes.map(c => ({ element: c.row, group: c.group, level: c.level })),
    };
  },

  onHostMessage(msg, ui) {
    const m = msg as HostToWebview;
    if (!m) { return; }
    if (m.type === 'init') {
      $('missing-banner').style.display = 'none';
      $('dim-name').textContent = m.dimName;
    } else if (m.type === 'notFound') {
      $('dim-name').textContent = m.dimName;
      $('missing-msg').textContent = m.message;
      $('missing-banner').style.display = 'flex';
      ($('btn-create') as HTMLButtonElement).disabled = false;
      $('matrix-wrap').innerHTML = `<div class="empty-state">${escapeHtml(L.cubeMissingCreateAbove)}</div>`;
    } else if (m.type === 'createError') {
      ($('btn-create') as HTMLButtonElement).disabled = false;
      ui.showStatus('error', fmt(L, 'createFailed', m.message));
    }
  },

  onReady(ui) {
    $('btn-create').addEventListener('click', () => {
      ui.post({ type: 'createCube' } satisfies WebviewToHost);
      ($('btn-create') as HTMLButtonElement).disabled = true;
      ui.showStatus('ok', L.creatingCube);
    });
  },
});
