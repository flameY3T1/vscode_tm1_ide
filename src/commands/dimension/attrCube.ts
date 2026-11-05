/**
 * Shared helpers for a dimension's attribute cube `}ElementAttributes_<Dim>`.
 *
 * Consolidates the formerly-duplicated existence checks in the dimension
 * editor and dimension browser. Pure REST layer dependency (`getCube`) — no
 * vscode, no cycle.
 */

import { getCube } from '../../tm1Rest/cubeApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';

/** The TM1 attribute-cube name for a dimension. */
export function attrCubeName(dimName: string): string {
  return `}ElementAttributes_${dimName}`;
}

/**
 * True if the dimension's attribute cube exists. TM1 only creates it once the
 * dimension has at least one attribute. Returns false when no config is given.
 */
export async function attrCubeExists(dimName: string, config?: Tm1Config): Promise<boolean> {
  if (!config) { return false; }
  try {
    await getCube(config, attrCubeName(dimName));
    return true;
  } catch {
    return false;
  }
}
