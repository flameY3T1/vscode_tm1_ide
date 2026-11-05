// src/commands/security/securityCubeNotice.ts
// Turns "the security control cube does not exist" into an empty matrix plus a
// sentence, instead of TM1's raw MDX parse error.
//
// TM1 creates `}DimensionSecurity`, `}CubeSecurity`, `}ProcessSecurity` and
// friends lazily — the very first permission assignment creates them. Until
// then, querying one fails with *"Syntax error at or near
// '[}DimensionSecurity]', character position 128"*, which names neither the
// cause nor a remedy. The read APIs raise `SecurityCubeMissingError` for that
// case (they probe the cube after a failed query); this helper is the UI half.
import * as vscode from 'vscode';
import { SecurityCubeMissingError } from '../../security/api/mdxCellset';

/**
 * `.catch()` handler for a permissions fetch: swallows a missing security cube
 * (→ empty permission map + info toast) and rethrows everything else.
 *
 * Used as `fetchAllDimPerms(cfg).catch(emptyOnMissingSecurityCube())` so the
 * fetch keeps running in parallel with the group/mode requests.
 */
export function emptyOnMissingSecurityCube<T>(): (e: unknown) => T {
  return (e: unknown): T => {
    if (e instanceof SecurityCubeMissingError) {
      void vscode.window.showInformationMessage(vscode.l10n.t(
        "No security of this kind is defined on this server yet — TM1 creates the control cube '{0}' the first time a permission is assigned.",
        e.cubeName,
      ));
      return {} as T;
    }
    throw e;
  };
}
