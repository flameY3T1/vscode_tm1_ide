/**
 * Message protocol of the process-template editor webview — imported by the
 * host (processTemplates/processTemplateEditor.ts) and this client.
 *
 * Receive-only on the client: the template arrives as injected globals, the
 * host never posts.
 */
import type { ProcessTemplateSource } from '../../processTemplates/processTemplateTypes';

/** Webview → extension. Fields optional on `save`: the host defaults each. */
export type WebviewToHost =
  | { type: 'cancel' }
  | ({
      type: 'save';
      name?: string;
      description?: string;
      servers?: string;
    } & Partial<ProcessTemplateSource>);
