// src/webviewClient/securityCubeMatrix/index.ts
// Thin adapter — render + event glue lives in _shared/securityMatrixCore.
import type { HostToWebview, WebviewToHost } from './protocol';
import type { CubePermLevel, PermLevel } from '../../security/types/permission';
import { LEVELS_PER_RESOURCE } from '../../security/core/permLevels';
import { runSecurityMatrix, type MatrixChange } from '../_shared/securityMatrixCore';

runSecurityMatrix<CubePermLevel>({
  entityLabel: 'Cube',
  entityLabelPlural: 'cubes',
  levels: LEVELS_PER_RESOURCE.cube as readonly CubePermLevel[],

  parseInit(msg) {
    const m = msg as HostToWebview;
    if (!m || m.type !== 'init') { return null; }
    const init = m as Extract<HostToWebview, { type: 'init' }>;
    return { rows: init.cubes, groups: init.groups, perms: init.perms };
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
      ok: s.ok.map(o => ({ row: o.cube, group: o.group })),
      errors: s.errors.map(e => ({ row: e.cube, group: e.group, reason: e.reason })),
    };
  },

  buildSaveMsg(changes: Array<MatrixChange<CubePermLevel>>): WebviewToHost {
    return {
      type: 'save',
      changes: changes.map(c => ({ cube: c.row, group: c.group, level: c.level as PermLevel })),
    };
  },
});
