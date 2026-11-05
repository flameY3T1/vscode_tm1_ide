/**
 * TM1 Cube-Maintenance helpers (SaveData / Unload / Load).
 *
 * Pure URL builders + thin wrappers around `apiRequest`. No vscode dependency.
 */

import { encodeODataKey } from '../utils/odataKey';

export type CubeMaintAction = 'SaveData' | 'Unload' | 'Load';

/** Builds the OData action URL for a cube maintenance call. */
export function buildCubeMaintUrl(cubeName: string, action: CubeMaintAction): string {
  return `Cubes('${encodeODataKey(cubeName)}')/tm1.${action}`;
}

/** Maps the action to a user-facing English source label (localized at the caller). */
export function labelForAction(action: CubeMaintAction): string {
  switch (action) {
    case 'SaveData': return 'Save cube data';
    case 'Unload':   return 'Unload cube';
    case 'Load':     return 'Load cube';
  }
}
