// src/webviewClient/securityCubeMatrix/protocol.ts
import type { Group } from '../../security/types/group';
import type { CubePermLevel, PermLevel } from '../../security/types/permission';

export type HostToWebview =
  | {
      type: 'init';
      cubes: string[];
      groups: Group[];
      perms: Record<string, Record<string, CubePermLevel>>;
      v12Mode: boolean;
    }
  | {
      type: 'saved';
      ok: Array<{ cube: string; group: string }>;
      errors: Array<{ cube: string; group: string; reason: string }>;
    }
  | { type: 'refreshed'; perms: Record<string, Record<string, CubePermLevel>> };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; changes: Array<{ cube: string; group: string; level: PermLevel }> }
  | { type: 'refresh' }
  | { type: 'openView' };
