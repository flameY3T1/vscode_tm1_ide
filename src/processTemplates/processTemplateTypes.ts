export interface ProcessTemplateSource {
  PrologProcedure: string;
  MetadataProcedure: string;
  DataProcedure: string;
  EpilogProcedure: string;
  Parameters: Array<{ Name: string; Type: 'String' | 'Numeric'; Value: string | number; Prompt?: string }>;
  Variables: Array<{ Name: string; Type: 'String' | 'Numeric'; Position?: number; StartByte?: number; EndByte?: number }>;
  DataSource: { Type: string; [k: string]: unknown };
}

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string;
  /** Semicolon-separated list of TM1 server names. Empty/undefined = always shown. */
  servers?: string;
  createdAt: string;
  source: ProcessTemplateSource;
}
