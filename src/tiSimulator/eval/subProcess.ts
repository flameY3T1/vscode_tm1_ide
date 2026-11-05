/**
 * Sub-process module + loader types for Phase 2.5 recursive simulation.
 *
 * When the evaluator encounters `ExecuteProcess('SubName', arg1, arg2, ...)`,
 * it asks the loader for `'SubName'`. If a module is returned, the simulator
 * descends into the sub's TI source recursively (sharing the parent's
 * OutputCollector + warning buffer). If `undefined` is returned, the existing
 * no-op-warning path runs.
 */

import type { RunSections } from '../types';
import type { SourceTable } from '../source/csvSource';

export type SubProcessModule = {
  sections: RunSections;
  /** Positional parameter names — ExecuteProcess args[1..N] bind to these. */
  parameterNames: string[];
  /**
   * Captured source rows from `<sub>_source.txt`. When present, sub's data
   * section iterates one pass per row binding variableNames → row values.
   * Absent for subs whose DataSource is `None`.
   */
  source?: SourceTable;
  /** Column names matching `source.rows[].columns`, from `<sub>.variables.json`. */
  variableNames?: string[];
};

export type SubProcessLoader = (name: string) => SubProcessModule | undefined;

