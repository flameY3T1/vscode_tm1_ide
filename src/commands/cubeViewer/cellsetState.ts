import { _cellsets } from './state';
import { _deleteCellset } from './cellset';

/** Drop + server-delete the panel's current cellset (re-execute / dispose). */
export function dropPanelCellset(panelKey: string): void {
  const cs = _cellsets.get(panelKey);
  if (cs) { _deleteCellset(cs.id, cs.config); _cellsets.delete(panelKey); }
}

/** Stash row dims + level maps onto a panel's persistent cellset (no-op if non-paged). */
export function _stashPageContext(
  panelKey: string, rowDims: string[], levelMaps: Map<string, number>[],
): void {
  const cs = _cellsets.get(panelKey);
  if (cs) { cs.rowDims = rowDims; cs.levelMaps = levelMaps; }
}
