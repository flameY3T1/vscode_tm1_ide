/**
 * Rule catalog of the readiness check. Removed functions come from two places:
 * `tiSignatures` (`deprecatedInV12`, read through `V12_DEPRECATED`) and `EXTRA_REMOVED`
 * below — names the editor must not offer because they never compile on 11.8 or 12.x,
 * but that a v11 process may still contain and the migration then carries over broken.
 */
import { V12_DEPRECATED } from '../tiLogicVisualizer/tiLinter/versionCompatPure';
import type { Evidence } from './types';

export const CATALOG_AS_OF = '2026-10-07';

export const IBM_DEPRECATED_URL =
  'https://www.ibm.com/docs/en/SSD29G_3.1.0/com.ibm.swg.ba.cognos.planning_analytics_engine.2.0.0.doc/c_pae_deprecated_features.html';
export const IBM_CHANGED_URL =
  'https://www.ibm.com/docs/en/SSD29G_3.1.0/com.ibm.swg.ba.cognos.planning_analytics_engine.2.0.0.doc/c_pae_changed_features.html';

/**
 * Names `deprecatedInV12` marks that IBM's list does NOT contain. Each compiles on 11.8
 * and fails on 12.5.9 (readinessFunctionFormProbe.js, 2026-10-07), so they
 * count as measured rather than documented. Everything else in `V12_DEPRECATED` is on
 * IBM's list.
 */
const MEASURED_ONLY = new Set([
  'datasourceodbocatalog', 'datasourceodboconnectionstring', 'datasourceodbocubename',
  'datasourceodbohierarchyname', 'datasourceodbolocation', 'datasourceodboprovider',
  'datasourceodbosapclientid', 'datasourceodbosapclientlanguage',
  'datasourcesapusingroleauths', 'datasourcesapusingtexts', 'lockon', 'lockoff',
  // Undocumented, compile on 11.8, fail on 12.5.9 (2026-10-07); listed by the Cubewise guide.
  'subsetformatstyleset', 'enablepersonalworkspace', 'deleteallinfocuberestrictions',
  'cubesetsapvariablesclause', 'datasourceaddsaphierarchy', 'datasourcedeleteallsaphierarchies',
  'sapodsinsert', 'setcharacteristicattributes', 'setcharacteristichierarchies',
  'setinfocubecharacteristics', 'setinfocubekeyfigures', 'setroleauthorizationcolumns',
  'createmultihierarchytestcubes', 'cubesetslicermembers',
]);

/**
 * Removed names that have no signature on purpose: they compile on neither 11.8 nor 12.5.9 in
 * any form the probe tries, so the editor must not offer them — yet a v11 process may still
 * contain one, and the migration then carries it over broken. Source: Cubewise migration
 * guide (TM1 12.6.4, github.com/meissacw/arc_plugins, 2026-10-03), re-measured here on
 * 2026-10-07 with tiFunctionCandidateProbe.js. The probe's "no" is no proof of
 * absence on v11 (mixed argument types, arity > 6), hence `reported`. The undocumented v11
 * functions that DO compile on 11.8 are signatures (signatures/46, `deprecatedInV12`).
 */
export const EXTRA_REMOVED: ReadonlyMap<string, { name: string; evidence: Evidence; replacement?: string }> = new Map(
  ([
    ...['CubeDRAcquire', 'CubeDRGet', 'CubeDRGetConflicts', 'CubeDRRelease', 'CubeDRReleaseAll',
      'CognosDimension', 'CognosPackage', 'CognosQuery', 'NWSAPCharacteristic', 'NWSAPInfoCube',
      'SAPAttributes', 'SAPCharacteristic', 'SAPCharacteristicTexts', 'SAPCurrency', 'SAPHierarchy', 'SAPInfoCube',
      'SAPOpen', 'SAPSecurity', 'SAPTable', 'ODBOCube', 'ODBODimension', 'ODBOMDXQuery', 'CubeSetIsVirtual',
    ].map(name => ({ name, evidence: 'reported' as Evidence })),
    // Not a TM1 function on either version (measured); the real one compiles on both.
    { name: 'RefreshSecurity', evidence: 'measured' as Evidence, replacement: 'SecurityRefresh' },
  ] as Array<{ name: string; evidence: Evidence; replacement?: string }>).map(e => [e.name.toLowerCase(), e]),
);

export function functionEvidence(name: string): Evidence {
  const lc = name.toLowerCase();
  return EXTRA_REMOVED.get(lc)?.evidence ?? (MEASURED_ONLY.has(lc) ? 'measured' : 'ibm');
}

/** Sanity hook for the test: every measured-only name must still be in the signatures. */
export function measuredOnlyNames(): string[] {
  return [...MEASURED_ONLY].filter(n => V12_DEPRECATED.has(n));
}

/**
 * Control cubes IBM lists as not supported in TM1 12. Their mere presence on the source is
 * no finding — the migration leaves them or they go. A process that READS or WRITES one is.
 */
/**
 * Characters the Database Migration Utility rejects in cube, dimension, view and subset
 * names — such an object is not migrated (Cubewise migration guide, TM1 12.6.4). Element
 * names are not affected.
 */
export const MIGRATION_INVALID_NAME_CHARS = '\\/:*?"<>|\';,';

/**
 * `tm1s.cfg` parameters IBM lists as not supported in TM1 12 (147 names, "Database
 * configuration options", same page as above, read 2026-10-07). On TM1 12 they have no effect;
 * what still matters is configured in PA Administration.
 */
export const UNSUPPORTED_CFG_PARAMS: ReadonlySet<string> = new Set([
  'AdminHost', 'AdminSvrSSLCertAuthority', 'AdminSvrSSLCertID', 'AdminSvrSSLCertRevList',
  'AdminSvrSSLExportKeyID', 'AllowedInvalidXNLogRecLimit',
  'ApplyMaximumViewSizeToEntireTransaction', 'CAMPortalVariableFile', 'CAMSSLCertificate',
  'CAMUseSSL', 'CacheFriendlyMalloc', 'CheckCAMClientAlias', 'ClientCAMURI',
  'ClientExportSSLSvrCert', 'ClientExportSSLSvrKeyID',
  'ClientMessageListenerAcceptsTm1TopConnections', 'ClientMessagePortNumber',
  'ClientPingCAMPassport', 'ClientPropertiesSyncInterval', 'ClientVersionMaximum',
  'ClientVersionMinimum', 'ClientVersionPrecision', 'CognosTM1InterfacePath',
  'CreateNewCAMClients', 'DHFile', 'DebugDatabaseLock', 'DefaultMeasuresDimension',
  'DisableExecuteCommandTI', 'DisableMemoryCache', 'DistributedPlanningOutputDir', 'Downtime',
  'EnableBatchCellIncrement', 'EnableNewHierarchyCreation', 'EnableODBCProxy',
  'EnableParallelFacetQuery', 'EnableSandboxTransactionLog', 'EncryptData',
  'ExcelWebPublishEnabled', 'ExportAdminSvrSSLCert', 'ExportSvrSSLCert', 'HTTPHostUri',
  'HTTPOriginAllowList', 'HTTPPortNumber', 'HTTPRequestEntityMaxSizeInKB',
  'HTTPSessionTimeoutMinutes', 'IPAddress', 'IPVersion', 'IdleConnectionTimeOutSeconds',
  'IndexStoreDirectory', 'IntegratedSecurityMode', 'JavaClassPath', 'JavaJVMArgs',
  'JavaJVMPath', 'KeepPrivateSubsetsLoaded', 'LDAPHost', 'LDAPPasswordFile',
  'LDAPPasswordKeyFile', 'LDAPPort', 'LDAPSearchBase', 'LDAPSearchField',
  'LDAPSkipSSLCRLVerification', 'LDAPSkipSSLCertVerification', 'LDAPUseServerAccount',
  'LDAPVerifyCertServerName', 'LDAPVerifyServerSSLCert', 'LDAPWellKnownUserName',
  'LicenseMetricProductName', 'LicenseMetricProductReleaseID', 'LicenseMetricProductVersion',
  'LicenseMetricTime', 'LoadPrivateSubsetsOnStartup', 'LoadPublicViewsAndSubsetsAtStartup',
  'LockPagesInMemory', 'LogMemoryAllocation', 'LogReleaseLineCount',
  'MDXAggregateForceSetAlgorithm', 'MDXSelectCalculatedMemberInputs', 'MTQ',
  'MaskUserNameInServerTools', 'MaxUDCCacheSize', 'MaximumLoginAttempts',
  'MaximumSynchAttempts', 'MaximumViewSize', 'MemoryCacheMaxBlockSize', 'MemoryWarningLevelKb',
  'MemoryWarningLevelMsg', 'MessageCompression', 'MinBreatherThreadCount',
  'NWSapCharacteristicMethod', 'NWSapCharacteristicRowcount', 'NWSapInfoCubeExtractMethod',
  'NetRecvBlockingWaitLimitSeconds', 'NetRecvMaxClientIOWaitWithinAPIsSeconds',
  'ODBCCatalogName', 'ODBCDataSource', 'ODBCLibraryPath', 'ODBCPassword', 'ODBCUserName',
  'OracleErrorForceRowStatus', 'OracleErrorUnicodeDateCharacterWorkaround',
  'ParallelInteraction', 'PasswordMinimumLength', 'PasswordSource', 'PerfMonIsActive',
  'PerformanceMonitorOn', 'PooledMemoryMaxLimit', 'PooledMemoryWarningThreshold', 'PortNumber',
  'ProfileBasedOptimization', 'ProgressMessage', 'PullInvalidationSubsets', 'RawStoreDirectory',
  'ReceiveProgressResponseTimeoutSecs', 'RulesOverwriteCellsOnLoad', 'RunningInBackground',
  'SSLCertAuthority', 'SSLCertRevocationFile', 'SSLCertificate', 'SSLCertificateID',
  'SSLPrivateKeyPwdFile', 'SSLPwdKeyFile', 'Savetime', 'SecurityPackageName', 'ServerCAMURI',
  'ServerCAMURIRetryAttempts', 'ServerLogging', 'ServerName', 'ServicePrincipalName',
  'SkipLoadingAliases', 'SkipSSLCAMHostCheck', 'SliceApprovalDimension', 'SliceCubeThreads',
  'StartupChores', 'SubsetElementBreatherCount', 'SvrSSLExportKeyID', 'SyncUnitSize',
  'TM1ConnectorforSAP', 'TrackMemoryPools', 'TransactionLogSearchOptimization',
  'UseCognosMDXEngine', 'UseLocalCopiesForPublicDynamicSubsets', 'UseSQLExtendedFetch',
  'UseSQLFetch', 'UseSQLFetchScroll', 'UseSSL', 'VersionedListControlDimensions', 'WANProxyHost',
].map(n => n.toLowerCase()));

/**
 * MDX that TM1 11 accepted and TM1 12 rejects or answers differently. `measured`: run on 11.8
 * and 12.5.9 on 2026-10-07 (scripts in the session notes) — v11 returns tuples, v12 answers
 * `501`. `reported`: from the Cubewise migration guide (12.6.4), where the v12 result is an
 * empty set without error, which a probe without suitable data cannot show.
 */
export const MDX_RULES: ReadonlyArray<{ key: string; re: RegExp; evidence: Evidence; storedOnly?: true }> = [
  { key: 'TM1ROLLUP', re: /\bTM1ROLLUP\s*\(/i, evidence: 'measured' },
  { key: 'TM1TupleSize', re: /\bTM1TupleSize\s*\(/i, evidence: 'measured' },
  { key: 'TM1SubsetBasis', re: /\bTM1SubsetBasis\s*\(/i, evidence: 'measured' },
  { key: '.Current', re: /\.Current\b(?!Member)/i, evidence: 'measured' },
  { key: '.AncestorsAll', re: /\.AncestorsAll\b/i, evidence: 'reported' },
  // TI lines end in ';' anyway, so only stored MDX is checked for a trailing one.
  { key: 'trailing ;', re: /;\s*$/, evidence: 'measured', storedOnly: true },
];

export const UNSUPPORTED_CONTROL_CUBES: readonly string[] = [
  '}ApplicationSecurity', '}Capabilities', '}ClientCAMAssociatedGroups', '}ClientProperties',
  '}ClientSettings', '}ConnectionProperties', '}CubeProperties', '}CubeSecurityProperties',
  '}DimensionProperties',
  // Not on IBM's page; listed by the Cubewise guide (12.6.4). `}StatsBy*` and
  // `}StatsForServer` are gone on 12.5.9 too (404, measured 2026-10-07).
  '}HierarchyProperties', '}ApplicationsEntries',
  '}StatsByCube', '}StatsByClient', '}StatsByChore', '}StatsByProcess', '}StatsByCubeByClient', '}StatsForServer',
];
