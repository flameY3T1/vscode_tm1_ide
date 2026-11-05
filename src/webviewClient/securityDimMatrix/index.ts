// src/webviewClient/securityDimMatrix/index.ts
// Thin adapter — render + event glue lives in _shared/securityMatrixCore.
import type { HostToWebview, WebviewToHost } from './protocol';
import type { DimPermLevel, PermLevel } from '../../security/types/permission';
import { LEVELS_PER_RESOURCE } from '../../security/core/permLevels';
import { runSecurityMatrix, type MatrixChange } from '../_shared/securityMatrixCore';

runSecurityMatrix<DimPermLevel>({
  entityLabel: 'Dimension',
  entityLabelPlural: 'dimensions',
  levels: LEVELS_PER_RESOURCE.dimension as readonly DimPermLevel[],

  parseInit(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'init') { return null; }
    const init = m as Extract<HostToWebview, { type: 'init' }>;
    return { rows: init.dims, groups: init.groups, perms: init.perms };
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
      ok: s.ok.map(o => ({ row: o.dim, group: o.group })),
      errors: s.errors.map(e => ({ row: e.dim, group: e.group, reason: e.reason })),
    };
  },

  buildSaveMsg(changes: Array<MatrixChange<DimPermLevel>>): WebviewToHost {
    return {
      type: 'save',
      changes: changes.map(c => ({ dim: c.row, group: c.group, level: c.level as PermLevel })),
    };
  },
});
