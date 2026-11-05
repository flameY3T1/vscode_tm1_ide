/**
 * Process-control + transaction lifecycle built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 */

import { type Builtin, noopVoid, expectArity } from './_helpers';

/** Section 1a (L107-123): process-execution sentinel + sub-process returns. */
export const PROC_INTRO_BUILTINS: Builtin[] = [
  // ProcessExit*() return-code sentinels, compared against the ExecuteProcess
  // result (`If(nRC <> ProcessExitNormal())`). Measured via transient processes
  // (2026-10-19) as [11.8, v12]; they are not ordinal and five of them shift
  // by one on v12. `fixtures.v12` comes from the captured server.
  ...Object.entries({
    ProcessExitNormal: [0, 0],
    ProcessExitWithMessage: [5, 5],
    ProcessExitMinorError: [7, 7],
    ProcessExitByBreak: [8, 8],
    ProcessExitByQuit: [9, 9],
    ProcessExitSeriousError: [11, 12],
    ProcessExitOnInit: [12, 13],
    ProcessExitByChoreQuit: [17, 18],
    ProcessExitByProcessRollback: [20, 21],
    ProcessExitByChoreRollback: [21, 22],
  }).map(([name, [v11, v12]]): Builtin => ({
    name,
    invoke: (args, fx) => { expectArity(name, args, 0); return fx?.v12 ? v12 : v11; },
  })),
  // ExecuteProcess / RunProcess in expression context return 0 (the sub-
  // process recursion itself runs via the statement-level handler in
  // evalStatement when the assign-RHS matches this name).
  {
    name: 'ExecuteProcess',
    invoke: () => 0,
  },
  {
    name: 'RunProcess',
    invoke: () => 0,
  },
  // v12 async-job functions (measured 2026-10-19). The simulator never runs a
  // RunProcess job, so every job counts as finished normally: GetJobStatus
  // answers ProcessExitNormal, never ProcessExecutionInProgress (10), which
  // would spin a `WHILE(GetJobStatus(s) = ProcessExecutionInProgress())` loop.
  { name: 'ProcessExecutionInProgress', invoke: (args) => { expectArity('ProcessExecutionInProgress', args, 0); return 10; } },
  { name: 'GetJobStatus', invoke: (args) => { expectArity('GetJobStatus', args, 1); return 0; } },
  noopVoid('WaitForAllJobs', 1, Infinity),
  noopVoid('WaitForAnyJobs', 1, Infinity),
  noopVoid('CancelJobs', 1, Infinity),
  noopVoid('WaitForInternalJobs', 0),
  // No network in the simulator: the call is skipped with a warning instead
  // of inventing a response.
  ...['ExecuteHttpRequest', 'HttpResponseGetBody', 'HttpResponseGetHeader', 'HttpResponseGetStatusCode'].map(
    (name): Builtin => ({
      name,
      invoke: () => { throw new Error(`${name}: HTTP requests are not simulated`); },
    }),
  ),
];

/** Section 20 (L1524-1530): tran / lifecycle that produces no observable sim state. */
export const TRAN_BUILTINS: Builtin[] = [
  noopVoid('TranSave', 1),
  noopVoid('TranDelete', 1),
  noopVoid('SaveDataAll', 0),
  noopVoid('CubeSaveData', 1),
  noopVoid('CubeUnload', 1),
  noopVoid('CubeLockOverride', 0, 8),
];
