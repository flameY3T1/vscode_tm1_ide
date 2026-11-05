// src/webviewClient/newProcess/protocol.ts
//
// Messages between the "New Process" wizard and its host
// (commands/processEditor/newProcess.ts). Field names of `finish` are the form
// keys commands/datasource/fromForm.ts#toDatasourceConfig reads.

export interface WizardParam { name: string; type: string; defaultValue: string; prompt: string }
export interface WizardVar { name: string; type: string; position: string; ignored: boolean }

export interface WizardFinish {
  name: string;
  templateId: string | null;
  dsType: string;
  datasourceName?: string;
  viewSubsetName?: string;
  delimiter?: string;
  quoteChar?: string;
  decimalSep?: string;
  thousandSep?: string;
  titleRows?: string;
  odbcUsername?: string;
  odbcPassword?: string;
  usesUnicode?: boolean;
  sqlQuery?: string;
  params: WizardParam[];
  variables: WizardVar[];
}

export type WebviewToHost =
  | { command: 'cancel' }
  | { command: 'getViews'; cube: string }
  | { command: 'getSubsets'; dimension: string }
  | { command: 'getCubeDimensions'; cube: string }
  | { command: 'finish'; data: WizardFinish };

export type HostToWebview =
  | { command: 'viewsLoaded'; views: string[] }
  | { command: 'subsetsLoaded'; subsets: string[] }
  | { command: 'cubeDimensionsLoaded'; dimensions: string[] };

/** window.__newProcess: the texts the script writes itself. */
export interface NewProcessBootstrap {
  texts: {
    nameRequired: string; description: string; paramDup: string;
    varsFromCube: string; varsEnterCube: string; varsCubeHint: string;
    varsSubset: string; varsSqlHint: string; varsAscii: string; varsNone: string;
  };
}
