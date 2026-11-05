// src/serverConfig/paramSchema.ts
import * as vscode from 'vscode';

export type Cluster =
  | 'connection' | 'security' | 'logging' | 'performance'
  | 'storage' | 'locale' | 'ti' | 'replication' | 'http' | 'misc';

export type ParamType = 'string' | 'number' | 'bool' | 'enum';

export interface ParamDef {
  name: string;
  cluster: Cluster;
  type: ParamType;
  enumValues?: string[];
  isStatic: boolean;
  requiresRestart: boolean;
  readonly?: boolean;
  description: string;
  defaultValue?: string | number | boolean;
  minVersion?: string;
}

const CLUSTERS: Cluster[] = [
  'connection', 'security', 'logging', 'performance',
  'storage', 'locale', 'ti', 'replication', 'http', 'misc',
];

export function allClusters(): Cluster[] { return [...CLUSTERS]; }

/**
 * Hand-maintained descriptions for the tm1s.cfg names under which the
 * configuration editor shows rows.
 *
 * Measured on 2026-08-31 against both test instances (11.8.02900.8 with 158
 * leaves, TM1 Database 12 with 64), and in the process removed eight entries that
 * NEITHER of the two servers knows and that appear in no IBM list:
 * `EnableTM1WebMTQ`, `NumericSeparators`, `DateFormat`, `Encoding`,
 * `CurrencyFormat`, `TI_ParallelLogging`, `ReplicationServerName`,
 * `ReplicationBandwidthLimit`. They appeared as ghost rows with "—" in the
 * form. The counterpart is in `LEAF_INFO` further below: descriptions
 * for the nested REST leaves that really exist.
 *
 * Re-measure: serverConfigSchemaProbe.js v11|v12.
 */
export const PARAM_SCHEMA: ParamDef[] = [
  // ── connection ──────────────────────────────────────────────────────────────
  {
    name: 'ServerName',
    cluster: 'connection',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Unique TM1 server name, visible in the Admin Host.'),
    defaultValue: 'Planning Sample',
  },
  {
    name: 'PortNumber',
    cluster: 'connection',
    type: 'number',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('TCP port for TM1 client-server communication (Architect/Perspectives).'),
    defaultValue: 12345,
  },
  {
    name: 'HTTPPortNumber',
    cluster: 'connection',
    type: 'number',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('HTTP port for the REST API. Restart required after change.'),
    defaultValue: 5000,
  },
  {
    name: 'ClientMessagePortNumber',
    cluster: 'connection',
    type: 'number',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Port for server-to-client notifications (status/cancel).'),
    defaultValue: 0,
  },
  {
    name: 'AdminHost',
    cluster: 'connection',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Hostname/IP of the TM1 Admin Server.'),
    defaultValue: 'localhost',
  },
  {
    name: 'IPVersion',
    cluster: 'connection',
    type: 'enum',
    enumValues: ['ipv4', 'ipv6', 'both'],
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('IP stack: ipv4, ipv6 or both.'),
  },
  {
    name: 'UseSSL',
    cluster: 'connection',
    type: 'bool',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Enable TLS for the client-server connection.'),
    defaultValue: false,
  },
  {
    name: 'SSLCertificateID',
    cluster: 'connection',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Distinguished name of the TLS server certificate (CN=…).'),
  },
  {
    name: 'SSLCertAuthority',
    cluster: 'connection',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Path to the CA certificate (PEM).'),
  },
  {
    name: 'KeyFile',
    cluster: 'connection',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Path to the private key file for TLS.'),
  },

  // ── security ─────────────────────────────────────────────────────────────
  // SecurityMode entry dropped — not in IBM PA 2.0 docs. The canonical TM1 11.x cfg
  // parameter is IntegratedSecurityMode (1..5); SecurityMode was a derived alias and
  // was already removed from the runtime fetch in an earlier commit.
  {
    name: 'IntegratedSecurityMode',
    cluster: 'security',
    type: 'enum',
    // 5 is missing on purpose: `tm1s.cfg` knows 5 (CAM with integrated login),
    // REST rejects it (measured 2026-09-18 on 11.8, 1..4 work). Whoever wants 5
    // writes to the file.
    // Two number spaces, measured on 2026-09-18 on 11.8. What is written is the
    // number from tm1s.cfg (1..5), as a JSON NUMBER — a string gives
    // `400 code 278 Invalid enum value encountered in payload.`. What is READ,
    // on the other hand, is the name of the OData enum `tm1.SecurityMode` (Basic/Integrated/
    // Mixed/CAM), which does NOT coincide with the cfg numbers: `2` landed
    // as cfg 2 and reported itself as "Mixed". That is why the name that was read stands
    // as an entry of its own in the selection (see serverConfigEditorWebview).
    enumValues: ['1', '2', '3', '4'],
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Integrated security mode, as the number in tm1s.cfg: 1 standard, 2 mixed, 3 integrated only, 4 CAM.'),
    defaultValue: '1',
  },
  {
    name: 'SecurityPackageName',
    cluster: 'security',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Name of the SSPI security package, e.g. Negotiate or NTLM.'),
    defaultValue: 'Negotiate',
  },
  {
    name: 'ClientCAMURI',
    cluster: 'security',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('CAM URI for client-side Cognos authentication.'),
  },
  {
    name: 'ServerCAMURI',
    cluster: 'security',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('CAM URI of the Cognos Gateway for server-side authentication.'),
  },
  {
    name: 'CAMPortalVariableFile',
    cluster: 'security',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Path to the CAM portal variable file for namespace mapping.'),
  },
  {
    name: 'LDAPHost',
    cluster: 'security',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('LDAP server hostname or IP for user authentication.'),
  },
  {
    name: 'LDAPPort',
    cluster: 'security',
    type: 'number',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('TCP port of the LDAP server (default 389, SSL 636).'),
    defaultValue: 389,
  },
  {
    name: 'EnableSandboxDimension',
    cluster: 'security',
    type: 'bool',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Enable the sandbox dimension for user-specific cell overrides.'),
    defaultValue: false,
  },
  {
    name: 'DisableSandboxing',
    cluster: 'security',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Disable sandboxes for all users (direct write-back mode). T = off, F = on. Dynamic — no restart required.'),
    defaultValue: false,
  },
  // RestrictMessageLogAccessToAdmin dropped — not in IBM PA 2.0 docs.

  // ── logging ──────────────────────────────────────────────────────────────
  {
    name: 'LoggingDirectory',
    cluster: 'logging',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Directory for TM1 server log files (tm1server.log).'),
  },
  {
    name: 'AuditLogOn',
    cluster: 'logging',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Enable audit logging (writes user actions to the audit log).'),
    defaultValue: false,
  },
  {
    name: 'AuditLogMaxFileSize',
    cluster: 'logging',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum size of an audit log file in MB before rollover.'),
    defaultValue: 100,
  },
  {
    name: 'AuditLogMaxQueryMemory',
    cluster: 'logging',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum memory in MB for audit log queries.'),
    defaultValue: 1000,
  },
  {
    name: 'MessageCompression',
    cluster: 'logging',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Enable compression of older TM1 message log entries.'),
    defaultValue: false,
  },
  {
    name: 'PerformanceMonitorOn',
    cluster: 'logging',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Enable performance monitor logging for cube operations.'),
    defaultValue: false,
  },
  {
    name: 'EventLogging',
    cluster: 'logging',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Enable extended event logging for diagnostic purposes.'),
    defaultValue: false,
  },

  // ── performance ──────────────────────────────────────────────────────────
  {
    name: 'MTQ',
    cluster: 'performance',
    type: 'string',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Multi-threaded query: ALL, a number of threads, or a negative number meaning all cores minus that many.'),
    defaultValue: 'ALL',
  },
  {
    name: 'MTQQuery',
    cluster: 'performance',
    type: 'string',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Multi-threaded query for cube view calculations. Values: ALL, AUTO, 0–N.'),
    defaultValue: 'AUTO',
  },
  {
    name: 'MTFeeders',
    cluster: 'performance',
    type: 'string',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Multi-threaded feeder calculation. Values: ALL, AUTO, 0–N.'),
    defaultValue: 'AUTO',
  },
  {
    name: 'MTCubeLoad',
    cluster: 'performance',
    type: 'string',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Multi-threaded cube loading at server start. Values: ALL, AUTO, 0–N.'),
    defaultValue: 'AUTO',
  },
  // ParallelInteraction dropped — not in IBM PA 2.0 docs.
  {
    name: 'MaximumViewSize',
    cluster: 'performance',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum size of a cube view result in cells.'),
    defaultValue: 1000000,
  },
  {
    name: 'JobQueuing',
    cluster: 'performance',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Enable job queuing for background processes.'),
    defaultValue: false,
  },
  {
    name: 'JobQueueThreadPoolSize',
    cluster: 'performance',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Number of worker threads in the job queue thread pool.'),
    defaultValue: 4,
  },
  {
    name: 'MaximumCubeLoadThreads',
    cluster: 'performance',
    type: 'number',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Maximum number of parallel threads when loading cubes at start.'),
    defaultValue: 4,
  },
  {
    name: 'MaximumMemoryForSubsetUndo',
    cluster: 'performance',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum memory in MB for subset undo information per user.'),
    defaultValue: 10,
  },

  // ── storage ──────────────────────────────────────────────────────────────
  {
    name: 'DataBaseDirectory',
    cluster: 'storage',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Root directory of the TM1 database (cubes, dims, processes).'),
  },
  // SaveDataDir dropped — not in IBM PA 2.0 docs (DataBaseDirectory is canonical).
  {
    name: 'PersistentFeeders',
    cluster: 'storage',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Persist feeder state to disk to avoid recalculation at start.'),
    defaultValue: false,
  },
  // AsyncronousWritebackTimeout (with IBM's historical typo) and MaxFeedersFiles
  // dropped — not in IBM PA 2.0 docs.
  {
    name: 'EnableNewHierarchyCreation',
    cluster: 'storage',
    type: 'bool',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Allow creation of new hierarchies in existing dimensions.'),
    defaultValue: true,
  },

  // ── locale ───────────────────────────────────────────────────────────────
  {
    name: 'Language',
    cluster: 'locale',
    type: 'string',
    isStatic: true,
    requiresRestart: true,
    description: vscode.l10n.t('Language of the TM1 server for error messages (e.g. EN, DE, FR).'),
    defaultValue: 'EN',
  },

  // ── ti ───────────────────────────────────────────────────────────────────
  // EnableNewSerialMode dropped — not in IBM PA 2.0 docs.
  {
    name: 'RunningInBackground',
    cluster: 'ti',
    type: 'bool',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Run TI processes in the background as asynchronous jobs.'),
    defaultValue: false,
  },
  {
    name: 'MaximumUserSandboxSize',
    cluster: 'ti',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum size of the user sandbox in MB.'),
    defaultValue: 256,
  },
  // MaximumTIStringSize dropped — not in IBM PA 2.0 docs.

  // ── replication ──────────────────────────────────────────────────────────
  // SyncCheckpointInterval dropped — not in IBM PA 2.0 docs.
  {
    name: 'SyncUnitSize',
    cluster: 'replication',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Number of objects per replication unit (batch size).'),
    defaultValue: 100,
  },

  // ── http ─────────────────────────────────────────────────────────────────
  {
    name: 'HTTPSessionTimeoutMinutes',
    cluster: 'http',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Inactivity timeout for REST sessions in minutes.'),
    defaultValue: 30,
  },
  {
    name: 'MaximumLoginAttempts',
    cluster: 'http',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Maximum number of failed login attempts before account lockout.'),
    defaultValue: 0,
  },
  // RequestThrottlingResponseSize dropped — not in IBM PA 2.0 docs.
  // HTTPSPortNumber dropped — not in IBM PA 2.0 docs (HTTPPortNumber covers both
  // HTTP and HTTPS via UseSSL toggle).

  // ── misc ─────────────────────────────────────────────────────────────────
  {
    name: 'ProductVersion',
    cluster: 'misc',
    type: 'string',
    isStatic: true,
    requiresRestart: false,
    readonly: true,
    description: vscode.l10n.t('TM1 server version (read-only).'),
  },
  // DebugUtility and EnableEventReporter dropped — not in IBM PA 2.0 docs.
  {
    name: 'IdleConnectionTimeOutSeconds',
    cluster: 'misc',
    type: 'number',
    isStatic: false,
    requiresRestart: false,
    description: vscode.l10n.t('Timeout in seconds after which idle client connections are dropped.'),
    defaultValue: 0,
  },
];

/**
 * Descriptions for NESTED REST leaves (`Performance.MTQ.UseAllThreads`),
 * keyed by their last segment — that is exactly how `buildRows` looks them up.
 *
 * Kept apart from `PARAM_SCHEMA`, and that is on purpose:
 *
 * - An entry here NEVER produces a row of its own. It only describes a leaf
 *   that the server reports anyway. `PARAM_SCHEMA`, on the other hand, carries tm1s.cfg names
 *   and puts up a row for each, even if the server does not know it
 *   (then as "does not exist here").
 * - `isStatic` and `requiresRestart` are missing. The editor derives those two from
 *   the snapshot (present in StaticConfiguration, missing in
 *   ActiveConfiguration => restart needed), and this derivation is MEASURED.
 *   A guessed marker would be a step backwards: it would make a false promise
 *   about effectiveness. We know description and type, not the
 *   restart semantics — so we only state the former.
 *
 * All names seen in the tree on 2026-08-31 on 11.8 and/or TM1 Database 12.
 * Mehrdeutige Endsegmente (`Port`, `Enable`, `Enabled`, `ScanFrequency`,
 * `ServerName`) are deliberately NOT here — otherwise they would come out on the wrong
 * row.
 */
export interface LeafInfo { cluster: Cluster; type: ParamType; description: string; }

const LEAF_INFO_RAW: Array<[string, Cluster, ParamType, string]> = [
  // ── Access.HTTP / Access.Network ────────────────────────────────────────
  ['SessionTimeout', 'http', 'string', vscode.l10n.t('Inactivity timeout for REST sessions, as an ISO-8601 duration (tm1s.cfg: HTTPSessionTimeoutMinutes).')],
  ['SessionMaxRequests', 'http', 'number', vscode.l10n.t('Maximum number of requests a single REST session may serve before it is closed. 0 means no limit.')],
  ['RequestEntityMaxSizeInKB', 'http', 'number', vscode.l10n.t('Maximum size in KB of a request body the REST API accepts.')],
  ['OriginAllowList', 'http', 'string', vscode.l10n.t('List of origins allowed to call the REST API from a browser (CORS).')],
  ['IdleConnectionTimeOut', 'connection', 'string', vscode.l10n.t('Idle time after which client connections are dropped, as an ISO-8601 duration (tm1s.cfg: IdleConnectionTimeOutSeconds).')],
  ['IPAddress', 'connection', 'string', vscode.l10n.t('Network address the server binds to when the machine has several.')],
  ['ReceiveProgressResponseTimeout', 'connection', 'string', vscode.l10n.t('How long the server waits for a client to answer a progress message, as an ISO-8601 duration.')],
  ['NetRecvBlockingWaitLimit', 'connection', 'string', vscode.l10n.t('Maximum time a receiving thread blocks before it gives up, as an ISO-8601 duration.')],
  ['NetRecvMaxClientIOWaitWithinAPIs', 'connection', 'string', vscode.l10n.t('Maximum time an API call waits for client input, as an ISO-8601 duration.')],

  // ── Access.CAM / Access.CAPI ────────────────────────────────────────────
  ['ServerURIs', 'security', 'string', vscode.l10n.t('Addresses of the Cognos Analytics gateways used for CAM authentication (tm1s.cfg: ServerCAMURI).')],
  ['CAMUseSSL', 'security', 'bool', vscode.l10n.t('Use TLS when the server talks to the CAM gateway.')],
  ['CreateNewCAMClients', 'security', 'bool', vscode.l10n.t('Create a TM1 client automatically the first time a CAM user logs in.')],
  ['ClientPingCAMPassport', 'security', 'string', vscode.l10n.t('Interval at which the server refreshes a CAM passport, as an ISO-8601 duration.')],
  ['ServerCAMURIRetryAttempts', 'security', 'number', vscode.l10n.t('Number of times the server retries a CAM gateway before it reports a failure.')],
  ['ClientVersionMinimum', 'connection', 'string', vscode.l10n.t('Oldest client version allowed to connect.')],
  ['ClientVersionMaximum', 'connection', 'string', vscode.l10n.t('Newest client version allowed to connect.')],
  ['ProgressMessage', 'connection', 'bool', vscode.l10n.t('Show a progress window in the client during long-running queries.')],

  // ── Access.SSL / Access.LDAP ────────────────────────────────────────────
  ['TLSCipherList', 'security', 'string', vscode.l10n.t('Cipher suites the server offers for TLS connections.')],
  ['FIPSOperationMode', 'security', 'bool', vscode.l10n.t('Restrict cryptography to FIPS 140-2 approved algorithms.')],
  ['NIST_SP800_131A_MODE', 'security', 'bool', vscode.l10n.t('Restrict cryptography to the NIST SP 800-131A algorithms and key lengths.')],
  ['KeyStashFile', 'security', 'string', vscode.l10n.t('File holding the stashed password of the key database.')],
  ['KeyLabel', 'security', 'string', vscode.l10n.t('Label of the certificate inside the key database that the server presents.')],
  ['CertRevocationFile', 'security', 'string', vscode.l10n.t('Certificate revocation list the server checks incoming certificates against.')],
  ['SearchBase', 'security', 'string', vscode.l10n.t('Distinguished name below which the server searches for LDAP users.')],
  ['SearchField', 'security', 'string', vscode.l10n.t('LDAP attribute matched against the name a user types when logging in.')],
  ['WellKnownUserName', 'security', 'string', vscode.l10n.t('Account the server binds with before it searches the LDAP directory.')],
  ['UseServerAccount', 'security', 'bool', vscode.l10n.t('Bind to LDAP with the account the TM1 service runs under instead of a separate one.')],
  ['VerifyServerSSLCert', 'security', 'bool', vscode.l10n.t('Verify the certificate the LDAP server presents.')],
  ['PasswordFile', 'security', 'string', vscode.l10n.t('File holding the encrypted password for the LDAP bind account.')],
  ['ServicePrincipalName', 'security', 'string', vscode.l10n.t('Service principal name the server registers for Kerberos authentication.')],

  // ── Administration ──────────────────────────────────────────────────────
  ['StartupChores', 'ti', 'string', vscode.l10n.t('Chores the server starts once loading has finished.')],
  ['DownTime', 'misc', 'string', vscode.l10n.t('Point in time at which the server stops accepting client connections.')],
  ['UnicodeUpperLowerCase', 'locale', 'bool', vscode.l10n.t('Change case with Unicode rules instead of the ASCII ones.')],
  ['AllowReadOnlyChoreReschedule', 'ti', 'bool', vscode.l10n.t('Let a chore be rescheduled while the server is in read-only mode.')],
  ['MaskUserNameInServerTools', 'security', 'bool', vscode.l10n.t('Hide user names in the server monitoring tools.')],
  ['PerfMonActive', 'logging', 'bool', vscode.l10n.t('Whether performance monitoring is currently running.')],
  ['LegacyTransactionLog', 'logging', 'bool', vscode.l10n.t('Write the transaction log in the pre-12 format.')],
  ['DefaultNumberFormat', 'locale', 'string', vscode.l10n.t('Number format the server falls back to when a value carries none of its own.')],
  ['PasswordMinimumLength', 'security', 'number', vscode.l10n.t('Shortest password the server accepts for a native TM1 user.')],
  ['ClientPropertiesSyncInterval', 'connection', 'string', vscode.l10n.t('Interval at which client properties are written back to the control cube, as an ISO-8601 duration.')],
  ['RetainNonCAMGroupMembership', 'security', 'bool', vscode.l10n.t('Keep a CAM user in TM1-only groups across logins.')],
  ['UpdateInterval', 'logging', 'string', vscode.l10n.t('Interval at which audit log entries are flushed to disk, as an ISO-8601 duration.')],
  ['LogReleaseLineCount', 'logging', 'number', vscode.l10n.t('Number of transaction log lines written before the lock is released once.')],
  ['ScanMode', 'logging', 'string', vscode.l10n.t('How the TopLog scan collects its samples.')],
  ['ThresholdForThreadRunningTime', 'logging', 'string', vscode.l10n.t('Running time above which a thread is written to the event log, as an ISO-8601 duration.')],
  ['ThresholdForThreadWaitingTime', 'logging', 'string', vscode.l10n.t('Waiting time above which a thread is written to the event log, as an ISO-8601 duration.')],
  ['ThresholdForThreadBlockingNumber', 'logging', 'number', vscode.l10n.t('Number of blocked threads above which an event log entry is written.')],
  ['ThresholdForPooledMemoryInMB', 'logging', 'number', vscode.l10n.t('Pooled memory in MB above which an event log entry is written.')],
  ['FileRetryCount', 'storage', 'number', vscode.l10n.t('Number of times a failed file operation is retried.')],
  ['FileRetryDelayMilliseconds', 'storage', 'number', vscode.l10n.t('Delay in milliseconds between two attempts at a file operation.')],
  ['FileRetryFileSpec', 'storage', 'string', vscode.l10n.t('File name pattern the retry logic applies to.')],
  ['ODBCLibraryPath', 'ti', 'string', vscode.l10n.t('Path to the ODBC driver manager the server loads for ODBC data sources.')],
  ['ODBCTimeoutInSeconds', 'ti', 'number', vscode.l10n.t('Seconds an ODBC query may run before it is cancelled. 0 means no limit.')],
  ['ODBCServiceRoot', 'ti', 'string', vscode.l10n.t('Address of the service that carries out ODBC queries for the database.')],
  ['SQLRowsetSize', 'ti', 'number', vscode.l10n.t('Number of rows fetched per round trip from an ODBC data source.')],
  ['SQLFetchType', 'ti', 'string', vscode.l10n.t('Fetch method used against an ODBC data source.')],
  ['OracleErrorForceRowStatus', 'ti', 'bool', vscode.l10n.t('Work around an Oracle driver that reports no row status.')],
  ['ClassPath', 'ti', 'string', vscode.l10n.t('Class path the embedded JVM uses for Java TI functions.')],
  ['JVMPath', 'ti', 'string', vscode.l10n.t('Path to the JVM library the server loads for Java TI functions.')],
  ['JVMArgs', 'ti', 'string', vscode.l10n.t('Arguments passed to the embedded JVM at startup.')],
  ['ExcelWebPublishEnabled', 'misc', 'bool', vscode.l10n.t('Allow websheets to be published from Excel.')],

  // ── Modelling ───────────────────────────────────────────────────────────
  ['DefaultMeasuresDimension', 'storage', 'string', vscode.l10n.t('Dimension treated as the measures dimension when a cube names none.')],
  ['MDXSelectCalculatedMemberInputs', 'storage', 'bool', vscode.l10n.t('Let MDX SELECT return the inputs of a calculated member.')],
  ['UserDefinedCalculations', 'storage', 'bool', vscode.l10n.t('Allow user-defined calculations in subsets and views.')],
  ['AllowSeparateNandCRules', 'storage', 'bool', vscode.l10n.t('Allow a separate rule for leaf cells and consolidated cells of the same area.')],
  ['AutomaticallyAddCubeDependencies', 'storage', 'bool', vscode.l10n.t('Register cube dependencies from rules automatically.')],
  ['ForceReevaluationOfFeedersForFedCellsOnDataChange', 'storage', 'bool', vscode.l10n.t('Re-evaluate feeders of a fed cell whenever its data changes.')],
  ['RulesOverwriteCellsOnLoad', 'storage', 'bool', vscode.l10n.t('Let a rule-calculated value replace a loaded value while the cube loads.')],
  ['SpreadingPrecision', 'storage', 'number', vscode.l10n.t('Tolerance by which the sum of a spread may differ from its target.')],
  ['ProportionSpreadToZeroCells', 'storage', 'bool', vscode.l10n.t('Include cells holding zero in a proportional spread.')],
  ['LoadPrivateSubsetsOnStartup', 'storage', 'bool', vscode.l10n.t('Load private subsets and views while the server starts.')],
  ['SkipLoadingAliases', 'storage', 'bool', vscode.l10n.t('Skip alias attributes while the server starts, to shorten startup.')],
  ['MaximumSynchAttempts', 'replication', 'number', vscode.l10n.t('Number of times a replication synchronisation is retried.')],
  ['EnableTIDebugging', 'ti', 'bool', vscode.l10n.t('Allow the TI debugger to attach to a running process.')],
  ['MaximumTILockObjects', 'ti', 'number', vscode.l10n.t('Maximum number of objects a TI process may lock at once.')],
  ['UseExcelSerialDate', 'ti', 'bool', vscode.l10n.t('Read dates from a data source as Excel serial numbers.')],
  ['CognosTM1InterfacePath', 'ti', 'string', vscode.l10n.t('Path to the interface libraries a TI process uses to reach Cognos.')],

  // ── Performance ─────────────────────────────────────────────────────────
  ['UseAllThreads', 'performance', 'bool', vscode.l10n.t('Use every available core for multi-threaded queries (tm1s.cfg: MTQ=ALL).')],
  ['NumberOfThreadsToUse', 'performance', 'number', vscode.l10n.t('Number of cores used for multi-threaded queries when not all are used (tm1s.cfg: MTQ).')],
  ['SingleCellConsolidation', 'performance', 'bool', vscode.l10n.t('Run multi-threaded queries for a single consolidated cell as well.')],
  ['ImmediateCheckForSplit', 'performance', 'bool', vscode.l10n.t('Check right away whether a query can be split across threads.')],
  ['OperationProgressCheckSkipLoopSize', 'performance', 'number', vscode.l10n.t('Number of loop passes between two cancellation checks in a threaded query.')],
  ['MTFeedersAtStartup', 'performance', 'bool', vscode.l10n.t('Compute feeders on several threads while the server starts.')],
  ['AtStartup', 'performance', 'bool', vscode.l10n.t('Compute feeders on several threads while the server starts.')],
  ['Weight', 'performance', 'number', vscode.l10n.t('Weight by which cubes are distributed across the loading threads.')],
  ['MinFileSize', 'performance', 'number', vscode.l10n.t('Smallest cube file that is loaded on several threads.')],
  ['UseBookmarkFiles', 'performance', 'bool', vscode.l10n.t('Use bookmark files to split a cube file across loading threads.')],
  ['ThreadSleepTime', 'performance', 'number', vscode.l10n.t('Milliseconds a job queue thread sleeps before it looks for work again.')],
  ['MaxWaitTime', 'performance', 'number', vscode.l10n.t('Milliseconds a job may wait in the queue before it is run regardless.')],
  ['ApplyMaximumViewSizeToEntireTransaction', 'performance', 'bool', vscode.l10n.t('Apply the maximum view size to a whole transaction instead of a single view.')],
  ['CacheFriendlyMalloc', 'performance', 'bool', vscode.l10n.t('Use the cache-friendly memory allocator.')],
  ['DisableMemoryCache', 'performance', 'bool', vscode.l10n.t('Switch off the internal memory cache.')],
  ['LockPagesInMemory', 'performance', 'bool', vscode.l10n.t('Keep the server pages in physical memory and out of the page file.')],
  ['MaximumGlobalQueryMemorySizeMB', 'performance', 'number', vscode.l10n.t('Memory in MB that all queries together may use.')],
  ['MaximumSingleQueryMemorySizeMB', 'performance', 'number', vscode.l10n.t('Memory in MB that a single query may use.')],
  ['PrivilegeGenerationOptimization', 'performance', 'bool', vscode.l10n.t('Compute security privileges only for the elements a request touches.')],
  ['ZeroWeightOptimization', 'performance', 'bool', vscode.l10n.t('Skip components whose weight is zero while consolidating.')],
  ['AllRuleCalcStargateOptimization', 'performance', 'bool', vscode.l10n.t('Let stargate views cache rule-calculated cells as well.')],
  ['UseStargateForRules', 'performance', 'bool', vscode.l10n.t('Answer rule-calculated cells from the stargate cache.')],
  ['MagnitudeDifferenceToBeZero', 'performance', 'number', vscode.l10n.t('Orders of magnitude below which a difference counts as zero.')],
  ['CheckFeedersMaximumCells', 'performance', 'number', vscode.l10n.t('Maximum number of cells the feeder check walks through.')],
  ['CalculationThresholdForStorage', 'performance', 'number', vscode.l10n.t('Number of calculated cells above which a result is kept in a stargate view.')],
  ['ViewConsolidationOptimization', 'performance', 'bool', vscode.l10n.t('Calculate a view along its consolidations instead of cell by cell.')],
  ['ViewConsolidationOptimizationMethod', 'performance', 'string', vscode.l10n.t('Method used for consolidation-wise view calculation.')],
  ['PullInvalidationSubsets', 'performance', 'bool', vscode.l10n.t('Invalidate dynamic subsets only when they are read.')],
  ['SubsetElementLockBreathing', 'performance', 'bool', vscode.l10n.t('Release the element lock now and then while a large subset is built.')],
  ['UseLocalCopiesForPublicDynamicSubsets', 'performance', 'bool', vscode.l10n.t('Give each session its own copy of a public dynamic subset.')],

  // ── Flat keys of the old `/Configuration` view ─────────────────────────
  // They are NOT in the nested tree and take no PATCH: all
  // six were fed with their own value on 2026-08-31, all six got
  // `400 Code 278 Invalid ServerSettings property`. They carry the EFFECTIVE
  // value; it is changed via the parameter named in each case.
  ['SecurityMode', 'security', 'string', vscode.l10n.t('Authentication mode the server resolved from its settings. Reported by the legacy configuration view; set it through IntegratedSecurityMode.')],
  ['PrincipalName', 'security', 'string', vscode.l10n.t('Service principal the server actually runs under. Reported by the legacy configuration view; set it through ServicePrincipalName.')],
  ['ClientCAMURIs', 'security', 'string', vscode.l10n.t('CAM gateway addresses the server hands to its clients. Reported by the legacy configuration view; set them through ClientCAMURI.')],
  ['WebCAMURI', 'security', 'string', vscode.l10n.t('CAM gateway address used by TM1 Web. Reported by the legacy configuration view.')],
  // Deliberately vague, because nothing more is documented: IBM lists the field in the
  // Configuration entity of the REST interface (type String), but says
  // nowhere what it is for, and in the tm1s.cfg parameter list it appears
  // for neither TM1 11 nor 12. An interpretation from the name would be a guess —
  // "distributed" in TM1 means "several servers on logical hosts", not
  // replication.
  ['DistributedOutputDir', 'storage', 'string', vscode.l10n.t('Directory path reported by the legacy configuration view. IBM lists the field in the REST configuration entity but does not document what it is for, and it is not a tm1s.cfg parameter in either the TM1 11 or the TM1 12 reference.')],

  // ── By full path, because the last segment is ambiguous ─────────────────
  // TM1 carries `Enable`, `Enabled` and `ScanFrequency` under several parents;
  // entered short, they would come out on the wrong row.
  ['Access.LDAP.Enable', 'security', 'bool', vscode.l10n.t('Authenticate users against an LDAP directory.')],
  ['Administration.ServerLog.Enable', 'logging', 'bool', vscode.l10n.t('Write the server message log.')],
  ['Administration.TopLog.Enable', 'logging', 'bool', vscode.l10n.t('Write the TopLog, which samples the running threads.')],
  ['Administration.TopLog.ScanFrequency', 'logging', 'string', vscode.l10n.t('Interval between two TopLog samples, as an ISO-8601 duration.')],
  ['Administration.EventLog.ScanFrequency', 'logging', 'string', vscode.l10n.t('Interval at which the server looks for event log conditions, as an ISO-8601 duration.')],
  ['Performance.MTFeeders.Enabled', 'performance', 'bool', vscode.l10n.t('Compute feeders on several threads.')],

  // ── Restliche gemessene Blaetter mit eindeutigem Endsegment ─────────────
  ['ClientExportServerKeyID', 'security', 'string', vscode.l10n.t('Key label the server exports to clients so they can verify it.')],
  ['VerifyCertServerName', 'security', 'bool', vscode.l10n.t('Check that the LDAP certificate names the host that was contacted.')],
  ['SkipSSLCertVerification', 'security', 'bool', vscode.l10n.t('Accept the LDAP certificate without verifying it.')],
  ['SkipSSLCRLVerification', 'security', 'bool', vscode.l10n.t('Accept the LDAP certificate without checking the revocation list.')],
  ['PasswordKeyFile', 'security', 'string', vscode.l10n.t('Key file with which the LDAP bind password was encrypted.')],
  ['ClientVersionPrecision', 'connection', 'number', vscode.l10n.t('Number of version parts compared when a client version is checked.')],
  ['TM1ConnectorforSAP', 'ti', 'bool', vscode.l10n.t('Make the SAP connector available to TI data sources.')],
  ['UseNewConnectorforSAP', 'ti', 'bool', vscode.l10n.t('Use the newer of the two SAP connectors.')],
];

const _leafInfo = new Map<string, LeafInfo>(
  LEAF_INFO_RAW.map(([name, cluster, type, description]) => [name, { cluster, type, description }]),
);

/**
 * Description of a nested leaf.
 *
 * Full path first, then the last segment. The path is the way out for
 * segments that TM1 carries under several parents (`Enable`, `Enabled`,
 * `ScanFrequency`) — they must not be entered short, because otherwise they would come out on the
 * wrong row.
 */
export function lookupLeafInfo(nameOrPath: string): LeafInfo | undefined {
  const byPath = _leafInfo.get(nameOrPath);
  if (byPath) { return byPath; }
  const seg = nameOrPath.split('.').pop();
  return seg === undefined ? undefined : _leafInfo.get(seg);
}

const _byName = new Map(PARAM_SCHEMA.map(p => [p.name, p]));

/**
 * What is read is the name of the OData enum, what is written is the number from `tm1s.cfg` —
 * the form shows the number throughout, otherwise before saving there is a
 * number in the field and afterwards a name.
 *
 * The pairs come from the meaning of the cfg numbers (IBM: 1 standard,
 * 2 mixed, 3 integrated only, 4 CAM); `2` -> `"Mixed"` was measured directly on 2026-09-18 on
 * 11.8.
 */
const SECURITY_MODE_CFG_NUMBER: Record<string, string> = {
  Basic: '1', Mixed: '2', Integrated: '3', CAM: '4',
};

/**
 * The display value of a row: enum name -> its number from `tm1s.cfg`.
 *
 * Tied to the PARAMETER NAME, not to the shape of the values. Until 2026-09-20
 * the condition was "all enum values are digits" — today that hits exactly
 * one parameter, and the next numeric enum (a log level, say)
 * would have silently received the same table `Basic/Mixed/Integrated/CAM`. A
 * mapping that happens to fit is not one.
 */
const NUMBER_ALIASES: Record<string, Record<string, string>> = {
  IntegratedSecurityMode: SECURITY_MODE_CFG_NUMBER,
};

export function normalizeEnumRead(def: ParamDef | undefined, value: unknown): unknown {
  if (def?.type !== 'enum' || typeof value !== 'string') { return value; }
  return NUMBER_ALIASES[def.name]?.[value] ?? value;
}

export function lookupSchema(name: string): ParamDef | undefined {
  return _byName.get(name);
}
