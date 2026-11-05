// ─── Section Restrictions ────────────────────────────────────────────────────

/**
 * Functions that are valid ONLY in the record loop (metadata or data) — they
 * need the current record context. Calling them in prolog/epilog is an
 * error (no record available).
 *
 * NB: `ItemReject` is deliberately NOT included here. It does reject the
 * current source record, but works in EVERY section: in the prolog
 * `IF(<bad param>); ItemReject('…'); ENDIF;` is an established parameter
 * validation pattern (aborts the process with a minor error before the
 * datasource is opened). A prolog/epilog hint would be a false positive there.
 * Only `ItemSkip` (skips THE current record) is meaningless without a record context.
 */
export const RECORD_LOOP_ONLY = new Set([
  'itemskip',
]);


/**
 * Special variables that may be assigned ONLY in the prolog — the datasource
 * is opened after the prolog, later assignments have no effect.
 * (Assignment check, not a function call.)
 */
export const PROLOG_ONLY_ASSIGN = new Set([
  'datasourcenameforserver', 'datasourcenameforclient', 'datasourcetype', 'datasourcequery',
  'datasourceusername', 'datasourcepassword',
  'datasourcecubeview', 'datasourcedimensionsubset',
  'datasourceasciidelimiter', 'datasourceasciidecimalseparator', 'datasourceasciithousandseparator',
  'datasourceasciiquotecharacter', 'datasourceasciiheaderrecords',
  'datasourceodbocatalog', 'datasourceodboconnectionstring', 'datasourceodbocubename',
  'datasourceodbohierarchyname', 'datasourceodbolocation', 'datasourceodboprovider',
  'datasourceodbosapclientid', 'datasourceodbosapclientlanguage',
  'minorerrorlogmax',
]);

/**
 * Metadata update functions: according to IBM they must NOT appear in the data OR epilog section.
 * Changes only take effect after the metadata section has finished;
 * in the data section they would also fire per record (performance bug).
 * They belong in prolog or metadata.
 *
 * NB: Client/group security functions (AddClient, AssignClientPassword,
 * RemoveClientFromGroup, …) are deliberately NOT included here — IBM documents
 * NO tab restriction for them, and the established best practice even puts them
 * in the epilog (AddClient in the prolog → commit → AssignClientPassword/…/
 * SecurityRefresh in the epilog). A data/epilog hint would be wrong there.
 */
export const METADATA_UPDATE_FUNCS = new Set([
  'dimensioncreate', 'dimensiondestroy', 'dimensiondeleteallelements',
  'dimensionelementinsert', 'dimensionelementdelete',
  'dimensionelementcomponentadd', 'dimensionelementcomponentdelete',
  'hierarchycreate', 'hierarchyelementinsert', 'hierarchyelementdelete',
  'cubecreate', 'cubedestroy',
  'ruleloadfromfile',
  'subsetcreate', 'subsetcreatebymdx', 'subsetdelete',
  'viewcreate', 'viewcreatebymdx',
  'elementattrinsert', 'elementattrdelete',
]);

/**
 * Functions that would fire per record in the data section (performance) but
 * are correct in the epilog. `SecurityRefresh` usually belongs in the epilog —
 * hence NOT in METADATA_UPDATE_FUNCS.
 */
export const DATA_PERF_ONLY = new Set([
  'securityrefresh',
]);

/**
 * Functions that should ideally appear only in the prolog (one-time initialisation).
 * Calling them in other sections produces a `performance-hint`.
 */
export const PROLOG_RECOMMENDED = new Set([
  'newdateformatter',
]);

/** Bare keywords that are valid TI statements (not real function calls). */
export const BARE_KEYWORDS = new Set([
  'itemskip', 'itemreject', 'processquit', 'processerror', 'processbreak',
  'processabort',
  // 'break' is a loop-exit keyword (valid inside While/End). Parser emits it
  // as functionCall name='Break' args=[] via tryParseBareKeyword; without it
  // here the linter raises unknown-function for every bedrock loop break.
  'break',
]);

/** Detect umlauts and the sharp s in the variable name. */
export const NON_ASCII_ID_RE = /[ÄÖÜäöüß]/;

/**
 * Characters that IBM lists as invalid in object names: `) | ~ ; @ \ / : * ? " < >` and `!`.
 * (@ is technically allowed, but discouraged as a string operator in rules.)
 * https://www.ibm.com/docs/en/planning-analytics/2.0.0?topic=development-tm1-object-naming-conventions
 */
export const INVALID_OBJECT_NAME_CHARS = /[)|~;@\\/:*?"<>!]/;

/**
 * Functions that name a NEW object → arg index(es) of the name literal.
 * Conservative: only unambiguous positions (no variadic subset forms whose
 * name index varies with the overload → false-positive risk).
 */
export const OBJECT_NAME_ARGS: Record<string, number[]> = {
  dimensioncreate: [0],
  cubecreate: [0],
  hierarchycreate: [1],
  dimensionelementinsert: [2],
  viewcreate: [1],
};

/** TI functions that cause an early exit from the current record/process. */
export const EARLY_EXIT_FUNCTIONS = new Set([
  'itemskip', 'itemreject', 'processbreak', 'processabort', 'processerror', 'processquit',
]);

/**
 * Comparison operator regex. The @-operators must be matched FIRST (longest match)
 * so that e.g. `@<=` is not partially consumed as `@<` leaving `=` behind.
 *
 * - Group 1 captures the full operator including optional @ prefix
 * - @-operators: @>=, @<=, @<>, @>, @<, @=
 * - Numeric operators: >=, <=, <>, >, <, =
 * - Negative look-behind (?<!@) prevents matching the base part of an @-operator
 *   as a standalone numeric operator.
 */
export const COMPARISON_RE = /(@>=|@<=|@<>|@>|@<|@=|(?<!@)>=|(?<!@)<=|(?<!@)<>|(?<!@)>|(?<!@)<|(?<!@)=)/;

/** Keywords filtered out of identifier scans (not variable references). */
export const TI_KEYWORDS = new Set([
  'if', 'elseif', 'else', 'endif', 'while', 'end',
  'and', 'or', 'not', 'mod',
]);
