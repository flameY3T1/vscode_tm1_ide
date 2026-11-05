// src/webviewClient/securityProcessMatrix/protocol.ts
import type { Group } from '../../security/types/group';
import type { ProcessPermLevel, PermLevel } from '../../security/types/permission';

export type HostToWebview =
  | {
      type: 'init';
      processes: string[];
      groups: Group[];
      perms: Record<string, Record<string, ProcessPermLevel>>;
      v12Mode: boolean;
    }
  | {
      type: 'saved';
      ok: Array<{ process: string; group: string }>;
      errors: Array<{ process: string; group: string; reason: string }>;
    }
  | { type: 'refreshed'; perms: Record<string, Record<string, ProcessPermLevel>> };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; changes: Array<{ process: string; group: string; level: PermLevel }> }
  | { type: 'refresh' }
  | { type: 'openView' };
