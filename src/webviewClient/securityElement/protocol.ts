// src/webviewClient/securityElement/protocol.ts
import type { Group } from '../../security/types/group';
import type { ElementPermLevel } from '../../security/types/permission';

export type HostToWebview =
  | {
      type: 'init';
      dimName: string;
      hierName: string;
      elements: string[];
      groups: Group[];
      perms: Record<string, Record<string, ElementPermLevel>>;
      v12Mode: boolean;
    }
  | {
      type: 'saved';
      ok: Array<{ element: string; group: string }>;
      errors: Array<{ element: string; group: string; reason: string }>;
    }
  | { type: 'refreshed'; perms: Record<string, Record<string, ElementPermLevel>> }
  | { type: 'notFound'; dimName: string; message: string }
  | { type: 'createError'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; changes: Array<{ element: string; group: string; level: ElementPermLevel }> }
  | { type: 'refresh' }
  | { type: 'createCube' }
  | { type: 'openView' };
