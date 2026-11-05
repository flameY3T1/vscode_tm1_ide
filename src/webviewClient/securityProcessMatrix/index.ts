// src/webviewClient/securityProcessMatrix/index.ts
// Thin adapter — render + event glue lives in _shared/securityMatrixCore.
import type { HostToWebview, WebviewToHost } from './protocol';
import type { ProcessPermLevel, PermLevel } from '../../security/types/permission';
import { LEVELS_PER_RESOURCE } from '../../security/core/permLevels';
import { runSecurityMatrix, type MatrixChange } from '../_shared/securityMatrixCore';

runSecurityMatrix<ProcessPermLevel>({
  entityLabel: 'Process',
  entityLabelPlural: 'processes',
  levels: LEVELS_PER_RESOURCE.process as readonly ProcessPermLevel[],

  parseInit(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'init') { return null; }
    const init = m as Extract<HostToWebview, { type: 'init' }>;
    return { rows: init.processes, groups: init.groups, perms: init.perms };
  },

  parseRefresh(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'refreshed') { return null; }
    return (m as Extract<HostToWebview, { type: 'refreshed' }>).perms;
  },

  parseSaved(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'saved') { return null; }
    const s = m as Extract<HostToWebview, { type: 'saved' }>;
    return {
      ok: s.ok.map(o => ({ row: o.process, group: o.group })),
      errors: s.errors.map(e => ({ row: e.process, group: e.group, reason: e.reason })),
    };
  },

  buildSaveMsg(changes: Array<MatrixChange<ProcessPermLevel>>): WebviewToHost {
    return {
      type: 'save',
      changes: changes.map(c => ({ process: c.row, group: c.group, level: c.level as PermLevel })),
    };
  },
});
