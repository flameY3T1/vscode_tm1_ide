import { describe, it, expect } from 'vitest';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

/**
 * The v12 deprecation flags drive a linter warning, so a wrong flag is a wrong warning on
 * code that is perfectly fine. Both lists below are pinned against evidence, not against
 * the doc pages alone — IBM's "not supported in TM1 12" list and the per-function topic
 * pages disagree (CubeUnload is on the list, its own page says nothing).
 *
 * Method for both: POST ExecuteProcessWithReturn with the call inside `IF(1=0); … ENDIF;`
 * so the compiler validates the name while the runtime never enters the branch.
 * CompletedSuccessfully = the function exists, Aborted = it does not (or the signature is
 * wrong, which is why arity 0..4 was swept in both the statement and the assigned form).
 */

/**
 * Live finding 2026-08-30, deliberately NOT set as a flag: `RuleLoadFromFileEx` and
 * `SubsetFormatStyleSet` compile on 11.8 but not on the v12 test server — yet they
 * are NOT on IBM's list below. This file is the anchor against invented
 * deprecations; a flag without IBM backing would weaken it. Anyone who still wants
 * to set them adds them here and names the source.
 *
 * Second finding of the same measurement: 15 of the 38 functions listed below do NOT
 * compile on 11.8 either (AddInfoCubeRestriction, AssociateCAMIDToGroup, BatchCellIncrement,
 * BatchUpdateFinish, BatchUpdateFinishWait, CGPromptGetNextMember, the four
 * CubeDataReservation*, CubeSetConnParams, DisableBulkLoadMode, EnableBatchCellIncrement,
 * RemoveCAMIDAssociation, ServerShutdown). There the flag says "goes away in v12"; the
 * truth is more like "does not exist on this 11.8 either". Left untouched — IBM's list
 * stays the anchor, and a single 11.8 server is no proof about all of 11.x.
 */
/**
 * Second source, deliberately kept separate: the ODBO/SAP data source variables.
 * IBM's list below does not name them — they are not functions but assignable
 * variables, and IBM only lists functions there. Two independent pieces of
 * evidence (2026-08-30) support the flag nonetheless:
 *   1. Cubewise's function library lists all ten as `v11`, not `v11,v12`.
 *   2. Measured live: readable without assignment on 11.8, not on the v12 test server.
 * The ODBO and SAP source types no longer exist in TM1 Database 12; so their
 * variables go away with them. See `tiAssignableVariables.test.ts`.
 */
const ODBO_SAP_V11_ONLY = [
  'DatasourceODBOCatalog', 'DatasourceODBOConnectionString', 'DatasourceODBOCubeName',
  'DatasourceODBOHierarchyName', 'DatasourceODBOLocation', 'DatasourceODBOProvider',
  'DatasourceODBOSAPClientID', 'DatasourceODBOSAPClientLanguage',
  'DatasourceSAPUsingRoleAuths', 'DatasourceSAPUsingTexts',
].map(n => n.toLowerCase());

/**
 * Third source, kept apart like the one above: undocumented v11 functions (no IBM page in
 * 2.0.0, 2.1.0 or 3.1.0). The Cubewise migration guide (TM1 12.6.4, 2026-10-03) lists them as
 * rejected by the v12 compiler, and they were re-measured on 2026-10-07 with
 * tiFunctionCandidateProbe.js: every one compiles on 11.8 and fails on 12.5.9.
 * This settles the `SubsetFormatStyleSet` case from the note above.
 */
const UNDOCUMENTED_V11_ONLY = [
  'SubsetFormatStyleSet', 'EnablePersonalWorkspace', 'DeleteAllInfoCubeRestrictions',
  'CubeSetSAPVariablesClause', 'DataSourceAddSAPHierarchy', 'DataSourceDeleteAllSAPHierarchies',
  'SAPODSInsert', 'SetCharacteristicAttributes', 'SetCharacteristicHierarchies',
  'SetInfoCubeCharacteristics', 'SetInfoCubeKeyFigures', 'SetRoleAuthorizationColumns',
  'CreateMultiHierarchyTestCubes', 'CubeSetSlicerMembers',
].map(n => n.toLowerCase());

/** IBM: "The following TurboIntegrator functions are not supported in TM1 12." (PA 3.1.0) */
const IBM_DEPRECATED_IN_V12 = [
  'AddInfoCubeRestriction', 'AllowExternalRequests', 'AssignClientPassword',
  'AssociateCAMIDToGroup', 'BatchCellIncrement', 'BatchUpdateFinish', 'BatchUpdateFinishWait',
  'BatchUpdateStart', 'CGAddPromptValues', 'CGPromptGetNextMember', 'CGPromptSize',
  'CreateHierarchyByAttribute', 'CubeDataReservationAcquire', 'CubeDataReservationGet',
  'CubeDataReservationGetConflicts', 'CubeDataReservationRelease',
  'CubeDataReservationReleaseAll', 'CubeGetLogChanges', 'CubeSaveData', 'CubeSetConnParams',
  'CubeSetLogChanges', 'CubeUnload', 'DisableBulkLoadMode', 'EnableBatchCellIncrement',
  'EnableBulkLoadMode', 'ExecuteCommand', 'ExecuteJavaN', 'ExecuteJavaS', 'LockOff', 'LockOn',
  'RefreshMDXHierarchy', 'RemoveCAMIDAssociation', 'RemoveCAMIDAssociationFromGroup',
  'SaveDataAll', 'ServerShutdown', 'SetChoreVerboseMessages', 'SetOdbcUnicodeInterface',
  'SwapAliasWithPrincipalName',
].map(n => n.toLowerCase());

/**
 * Compiled on the v12 test server (PA Engine, db tm1_v12_test) on 2026-08-09 — flagging
 * them warned about working code. ODBC survives v12 through the Data Connector, and so do
 * sandboxes and the security overlay.
 */
const LIVE_VERIFIED_ALIVE_IN_V12 = [
  'ODBCOpen', 'ODBCClose', 'ODBCOutput', 'ODBCOpenEx',
  'SecurityOverlayCreateGlobalDefault', 'SecurityOverlayDestroyGlobalDefault',
  'SecurityOverlayGlobalLockCell', 'SecurityOverlayGlobalLockNode',
  'ServerActiveSandboxGet', 'ServerSandboxClone', 'ServerSandboxCreate',
  'ServerSandboxDiscardAllChanges', 'ServerSandboxGet', 'ServerSandboxListCountGet',
  'ServerSandboxMerge', 'ServerSandboxesDelete',
];

/**
 * Never compiled on 11.8 either — with any arity from 0 to 4, as a statement and assigned.
 * They were never TI functions, so autocomplete must not offer them. Same class as the
 * POWER/LOG10 entries removed earlier.
 */
const NEVER_EXISTED = [
  'ODBCInsert', 'ODBCUpdate', 'ODBCDelete',
  'ODBCValue', 'ODBCValueN', 'ODBCValueS',
  'ODBCInsertOpen', 'ODBCInsertClose',
];

describe('v12 deprecation flags', () => {
  it('flags exactly what IBM lists as unsupported in TM1 12', () => {
    const flagged = [...KNOWN_SIGNATURES.entries()]
      .filter(([, sig]) => sig.deprecatedInV12 === true)
      .map(([key]) => key);
    const extra = flagged.filter(k => !IBM_DEPRECATED_IN_V12.includes(k) && !ODBO_SAP_V11_ONLY.includes(k) && !UNDOCUMENTED_V11_ONLY.includes(k));
    expect(extra).toEqual([]);
  });

  it('does not flag functions that were live-verified to work on v12', () => {
    for (const name of LIVE_VERIFIED_ALIVE_IN_V12) {
      const sig = KNOWN_SIGNATURES.get(name.toLowerCase());
      expect(sig, `${name} should still be a known signature`).toBeDefined();
      expect(sig?.deprecatedInV12, `${name} compiles on v12 — flagging it warns about working code`).toBeUndefined();
    }
  });

  it('names the replacement where IBM gives one', () => {
    // ExecuteCommand is the only one on IBM's list with a named successor. It stays a hint,
    // not a quickfix: a shell command does not translate into an HTTP request mechanically.
    expect(KNOWN_SIGNATURES.get('executecommand')?.v12Replacement).toBe('ExecuteHttpRequest');
    expect(KNOWN_SIGNATURES.has('executehttprequest')).toBe(true);
  });

  it('knows no function that exists on neither server', () => {
    for (const name of NEVER_EXISTED) {
      expect(KNOWN_SIGNATURES.has(name.toLowerCase()), `${name} never compiled on 11.8 or v12`).toBe(false);
    }
  });
});
