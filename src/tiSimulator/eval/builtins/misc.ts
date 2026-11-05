import { type Builtin, noopVoid, expectArity } from './_helpers';

/**
 * No-op / side-effect builtins. TM1 runs these live during capture (they touch
 * the message log, sandbox state, log-change flags, or process globals — never
 * cube/dim DATA), so the simulator treats them as no-ops. `noopVoid` returns 1;
 * the return value is ignored at statement level and harmless in expressions.
 * Adding them stops `unsupported call '…'` warnings and lets processes that use
 * them run to completion.
 */
export const MISC_BUILTINS: Builtin[] = [
  // Message log — pure logging, no data effect.
  noopVoid('LogOutput', 2),
  // Timing.
  noopVoid('Sleep', 1),
  // Locking.
  noopVoid('Synchronized', 1, 2),
  // Process global-variable declarations (the variable itself is set later).
  noopVoid('StringGlobalVariable', 1),
  noopVoid('NumericGlobalVariable', 1),
  // Cube log-change flags.
  noopVoid('CubeSetLogChanges', 2),
  noopVoid('CubeGetLogChanges', 1),
  // Sandbox control.
  noopVoid('SetUseActiveSandboxProperty', 1),
  noopVoid('ServerActiveSandboxSet', 1),
  noopVoid('ServerActiveSandboxGet', 0),
  // Feeder processing — a server-side recompute, no logged data mutation.
  noopVoid('CubeProcessFeeders', 1),
  {
    // No sandbox exists in the simulation context.
    name: 'ServerSandboxExists',
    invoke: (args) => {
      expectArity('ServerSandboxExists', args, 1);
      return 0;
    },
  },
  {
    // Cells are assumed updateable — the simulator has no security/rule context
    // that would lock a cell. `CellIsUpdateable(cube, e1, …, eN)` is variadic.
    name: 'CellIsUpdateable',
    invoke: (args) => {
      if (args.length < 2) throw new Error('CellIsUpdateable: needs at least 2 args (cube, e1)');
      return 1;
    },
  },
];
