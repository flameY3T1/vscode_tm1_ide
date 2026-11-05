import { type Builtin, noopVoid, expectArity } from './_helpers';

/**
 * Batch ⑥ — write / schema-mutation / security / file no-ops (2026-07-13).
 *
 * TM1 executes these live during capture, but they mutate SERVER STATE the
 * simulator does not model (client/group security, cube/dim schema, view &
 * subset config, files on disk) — never observable cube/dim DATA that the diff
 * compares. So the simulator treats them as no-ops: validate arity, return 1.
 * Registering them stops `unsupported call '…'` warnings and lets processes
 * that use them run to completion. Arities mirror the signature JSONs.
 *
 * Control-flow verbs (ProcessBreak/ProcessQuit/ProcessError, ItemSkip/Reject)
 * are NOT here — they are handled as keywords in evalStatement.ts.
 */
export const WRITE_OPS_BUILTINS: Builtin[] = [
  // --- File / IO ---------------------------------------------------------
  noopVoid('ASCIIDelete', 1),
  noopVoid('RuleLoadFromFile', 2),
  {
    // WildcardFileSearch(pattern, previousMatch) returns the next matching
    // filename, or '' when none remain. The simulator has no filesystem, so
    // always report "no match" — callers loop `WHILE(sFile @<> '')`, which
    // then never enters the body (safe: no phantom file iterations).
    name: 'WildcardFileSearch',
    invoke: (args) => {
      expectArity('WildcardFileSearch', args, 2);
      return '';
    },
  },

  // --- Cube / dimension schema mutation ---------------------------------
  noopVoid('CubeClearData', 1),
  noopVoid('CubeRuleSet', 2),
  noopVoid('DimensionUpdateDirect', 1),
  noopVoid('HierarchyUpdateDirect', 2),
  noopVoid('DimensionDeleteAllElements', 1),
  noopVoid('HierarchySortOrder', 6),

  // --- View / subset config + aliases -----------------------------------
  noopVoid('ViewCreateByMDX', 3, 4),
  noopVoid('PublishView', 4),
  noopVoid('PublishSubset', 3),
  noopVoid('SubsetAttrPutS', 4, 5),
  noopVoid('SubsetAttrPutN', 4, 5),
  noopVoid('ViewAttrPutS', 4, 5),
  noopVoid('ViewAttrPutN', 4, 5),
  noopVoid('SwapAliasWithPrincipalName', 2, 3),
  noopVoid('CubeAttrPutS', 3, 4),
  noopVoid('CubeAttrPutN', 3, 4),
  noopVoid('DimensionAttrPutS', 3, 4),
  noopVoid('DimensionAttrPutN', 3, 4),
  noopVoid('HierarchyAttrPutS', 4),
  noopVoid('HierarchyAttrPutN', 4),
  noopVoid('ProcessAttrPutS', 3, 4),
  noopVoid('ProcessAttrPutN', 3, 4),
  noopVoid('ChoreAttrPutS', 3, 4),
  noopVoid('ChoreAttrPutN', 3, 4),
  noopVoid('HierarchySubsetAttrPutS', 5),
  noopVoid('HierarchySubsetAttrPutN', 5),

  // --- Security: client / group ------------------------------------------
  noopVoid('AddClient', 1, 2),
  noopVoid('AddClientToGroup', 2),
  noopVoid('AddGroup', 1),
  noopVoid('AssignClientToGroup', 2),
  noopVoid('AssignClientPassword', 2),
  noopVoid('DeleteClient', 1),
  noopVoid('DeleteGroup', 1),
  noopVoid('RemoveClientFromGroup', 2),
  noopVoid('SecurityRefresh', 0),

  // --- Server / ODBC housekeeping -----------------------------------------
  noopVoid('DeleteAllPersistentFeeders', 0),
  noopVoid('ReturnSQLTableHandle', 0),
  // Returns 1, a number (measured on v12; the signature catalog says string).
  noopVoid('ReturnTableHandle', 0),
];
