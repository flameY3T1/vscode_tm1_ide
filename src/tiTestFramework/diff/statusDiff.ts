/**
 * Compare process-status + ErrorLog content between expected and actual.
 */

export type ProcessStatus = 'success' | 'minorErrors' | 'majorErrors' | 'quitCalled' | 'rollback';

export type StatusSnapshot = {
  status: ProcessStatus;
  errorLogContent: string;
  durationMs?: number;
};

export type StatusDiffResult = {
  equal: boolean;
  statusMatch: boolean;
  errorLogMatch: boolean;
  expected: StatusSnapshot;
  actual: StatusSnapshot;
};
