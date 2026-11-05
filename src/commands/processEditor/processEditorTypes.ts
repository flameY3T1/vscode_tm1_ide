import type { ProcessParameter, ProcessVariable, DataSource } from '../../tm1Client';

export interface ProcessData {
  processName: string;
  parameters: ProcessParameter[];
  dataSource: DataSource;
  variables: ProcessVariable[];
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
  /** Process "Security access" flag — runs with full access regardless of user. */
  hasSecurity: boolean;
}

export interface BreakpointMessage {
  section: 'Prolog' | 'Metadata' | 'Data' | 'Epilog';
  line: number;
  enabled: boolean;
}
