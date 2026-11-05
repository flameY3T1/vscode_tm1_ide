// src/webviewClient/workbenchPicker/protocol.ts
// Messages and config between the workbench picker window and its host
// (commands/workbench/saveFlow.ts, markup in workbenchPickerHtml.ts).

export type WebviewToHost =
  | { type: 'cancel' }
  | { type: 'save'; name: string; ids: string[] };

/** Content of the JSON block with id wbcfg, written by the host into the body. */
export interface PickerConfig {
  max: number;
  /** Pattern with {0} = checked, {1} = all, {2} = max. */
  counter: string;
  /** Names that already exist on this server, minus the one being edited. */
  existing: string[];
  save: string;
  overwrite: string;
  name: string;
}
