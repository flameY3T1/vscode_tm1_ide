import type { ProcSection } from './types';

/** Webview → host. The page only reports clicks; all rendering happens on the host. */
export type WebviewToHost =
  | { type: 'open'; process: string; section?: ProcSection; line: number }
  | { type: 'openRules'; cube: string; line: number }
  | { type: 'export'; format: 'html' | 'md'; cut: 'full' | 'extract' }
  | { type: 'rescan' }
  | { type: 'compileV12' }
  | { type: 'decide'; id: string; value: string }
  | { type: 'saveAssessment' }
  | { type: 'openAssessment' };
