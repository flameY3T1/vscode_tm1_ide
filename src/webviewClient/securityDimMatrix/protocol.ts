// src/webviewClient/securityDimMatrix/protocol.ts
import type { Group } from '../../security/types/group';
import type { DimPermLevel, PermLevel } from '../../security/types/permission';

export type HostToWebview =
  | {
      type: 'init';
      dims: string[];
      groups: Group[];
      perms: Record<string, Record<string, DimPermLevel>>;
      v12Mode: boolean;
    }
  | {
      type: 'saved';
      ok: Array<{ dim: string; group: string }>;
      errors: Array<{ dim: string; group: string; reason: string }>;
    }
  | { type: 'refreshed'; perms: Record<string, Record<string, DimPermLevel>> };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; changes: Array<{ dim: string; group: string; level: PermLevel }> }
  | { type: 'refresh' }
  | { type: 'openView' };
