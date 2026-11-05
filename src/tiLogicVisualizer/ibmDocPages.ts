/**
 * Where IBM documents each TI function, measured against the live site on 2026-10-07.
 *
 * Default (not listed here): `functions-<name>` exists under both 2.1.0 (v11) and 3.1.0 (v12).
 * Method: every signature probed as `<version>?topic=functions-<name>` under 2.0.0, 2.1.0 and
 * 3.1.0 (an unknown topic answers 302 to the version root, a real one 200). Misses were looked
 * up by link text in the per-version bot index (`/docs/en/planning-analytics/<version>`) and the
 * old file URL resolved through IBM's own redirect to its topic — that is how the local
 * variables (`variables-…`) and `batchupdatefinishwait-batchupdatestart` were found. The
 * `ProcessExit*` constants have no page of their own; IBM lists them under ProcessReturnCode, the
 * FILE_OPEN_* helpers under ASCIIOutputOpen.
 */

/**
 * Signatures for which neither probe nor bot index found a page in any of the three versions.
 * No link beats a link that lands on the doc root.
 */
export const IBM_DOC_NONE: ReadonlySet<string> = new Set([
  'allowexternalrequests', 'batchcellincrement', 'break', 'cgaddpromptvalues',
  'cgpromptgetnextmember', 'cgpromptsize', 'datasourceodbocatalog',
  'datasourceodboconnectionstring', 'datasourceodbocubename', 'datasourceodbohierarchyname',
  'datasourceodbolocation', 'datasourceodboprovider', 'datasourceodbosapclientid',
  'datasourceodbosapclientlanguage', 'datasourcesapusingroleauths', 'datasourcesapusingtexts',
  'enablebatchcellincrement', 'lockoff', 'lockon',
  'returnsqltablehandle', 'returnviewhandle', 'swapaliaswithprincipalname',
  // Undocumented v11 functions (signatures/46): 302 under 2.0.0, 2.1.0 and 3.1.0, measured 2026-10-07.
  'createmultihierarchytestcubes', 'cubesetsapvariablesclause', 'cubesetslicermembers',
  'datasourceaddsaphierarchy', 'datasourcedeleteallsaphierarchies', 'deleteallinfocuberestrictions',
  'enablepersonalworkspace', 'sapodsinsert', 'setcharacteristicattributes',
  'setcharacteristichierarchies', 'setinfocubecharacteristics', 'setinfocubekeyfigures',
  'setroleauthorizationcolumns',
]);

/**
 * Pages that are not `functions-<name>` in both lines: `[v11 path, v12 path]`, null where that
 * line has no page. Deprecated functions are gone from 3.1.0, the HTTP/JSON/job family only
 * exists there; the other line's page is used as fallback.
 */
export const IBM_DOC_PAGES: Readonly<Record<string, readonly [string | null, string | null]>> = {
  addinfocuberestriction: ['2.1.0?topic=functions-addinfocuberestriction', null],
  assignclientpassword: ['2.1.0?topic=functions-assignclientpassword', null],
  associatecamidtogroup: ['2.1.0?topic=functions-associatecamidtogroup', null],
  batchupdatefinish: ['2.1.0?topic=functions-batchupdatefinish', null],
  batchupdatefinishwait: ['2.1.0?topic=functions-batchupdatefinishwait', null],
  batchupdatestart: ['2.1.0?topic=batchupdatefinishwait-batchupdatestart', null],
  canceljobs: [null, '3.1.0?topic=functions-canceljobs'],
  createhierarchybyattribute: ['2.1.0?topic=functions-createhierarchybyattribute', null],
  cubedatareservationacquire: ['2.1.0?topic=functions-cubedatareservationacquire', null],
  cubedatareservationget: ['2.1.0?topic=functions-cubedatareservationget', null],
  cubedatareservationgetconflicts: ['2.1.0?topic=functions-cubedatareservationgetconflicts', null],
  cubedatareservationrelease: ['2.1.0?topic=functions-cubedatareservationrelease', null],
  cubedatareservationreleaseall: ['2.1.0?topic=functions-cubedatareservationreleaseall', null],
  cubegetlogchanges: ['2.1.0?topic=functions-cubegetlogchanges', null],
  cubesavedata: ['2.1.0?topic=functions-cubesavedata', null],
  cubesetconnparams: ['2.1.0?topic=functions-cubesetconnparams', null],
  cubesetlogchanges: ['2.1.0?topic=functions-cubesetlogchanges', null],
  cubeunload: ['2.0.0?topic=functions-cubeunload', null],
  dataminorerrorcount: ['2.1.0?topic=variables-dataminorerrorcount', '3.1.0?topic=variables-dataminorerrorcount'],
  datasourceasciidecimalseparator: ['2.1.0?topic=variables-datasourceasciidecimalseparator', '3.1.0?topic=variables-datasourceasciidecimalseparator'],
  datasourceasciidelimiter: ['2.1.0?topic=variables-datasourceasciidelimiter', '3.1.0?topic=variables-datasourceasciidelimiter'],
  datasourceasciiheaderrecords: ['2.1.0?topic=variables-datasourceasciiheaderrecords', '3.1.0?topic=variables-datasourceasciiheaderrecords'],
  datasourceasciiquotecharacter: ['2.1.0?topic=variables-datasourceasciiquotecharacter', '3.1.0?topic=variables-datasourceasciiquotecharacter'],
  datasourceasciithousandseparator: ['2.1.0?topic=variables-datasourceasciithousandseparator', '3.1.0?topic=variables-datasourceasciithousandseparator'],
  datasourcecubeview: ['2.1.0?topic=variables-datasourcecubeview', '3.1.0?topic=variables-datasourcecubeview'],
  datasourcedimensionsubset: ['2.1.0?topic=variables-datasourcedimensionsubset', '3.1.0?topic=variables-datasourcedimensionsubset'],
  datasourcenameforclient: ['2.1.0?topic=variables-datasourcenameforclient', '3.1.0?topic=variables-datasourcenameforclient'],
  datasourcenameforserver: ['2.1.0?topic=variables-datasourcenameforserver', '3.1.0?topic=variables-datasourcenameforserver'],
  datasourcepassword: ['2.1.0?topic=variables-datasourcepassword', '3.1.0?topic=variables-datasourcepassword'],
  datasourcequery: ['2.1.0?topic=variables-datasourcequery', '3.1.0?topic=variables-datasourcequery'],
  datasourcetype: ['2.1.0?topic=variables-datasourcetype', '3.1.0?topic=variables-datasourcetype'],
  datasourceusername: ['2.1.0?topic=variables-datasourceusername', '3.1.0?topic=variables-datasourceusername'],
  disablebulkloadmode: ['2.1.0?topic=functions-disablebulkloadmode', null],
  enablebulkloadmode: ['2.1.0?topic=functions-enablebulkloadmode', null],
  executecommand: ['2.1.0?topic=functions-executecommand', null],
  executehttprequest: [null, '3.1.0?topic=functions-executehttprequest'],
  executejavan: ['2.0.0?topic=functions-executejavan', null],
  executejavas: ['2.0.0?topic=functions-executejavas', null],
  fileopenappend: ['2.1.0?topic=functions-asciioutputopen', '3.1.0?topic=functions-asciioutputopen'],
  fileopenshared: ['2.1.0?topic=functions-asciioutputopen', '3.1.0?topic=functions-asciioutputopen'],
  getjobstatus: [null, '3.1.0?topic=functions-getjobstatus'],
  httpresponsegetbody: [null, '3.1.0?topic=functions-httpresponsegetbody'],
  httpresponsegetheader: [null, '3.1.0?topic=functions-httpresponsegetheader'],
  httpresponsegetstatuscode: [null, '3.1.0?topic=functions-httpresponsegetstatuscode'],
  jsonadd: [null, '3.1.0?topic=functions-jsonadd'],
  jsondiff: [null, '3.1.0?topic=functions-jsondiff'],
  jsonget: [null, '3.1.0?topic=functions-jsonget'],
  jsongetkey: [null, '3.1.0?topic=functions-jsongetkey'],
  jsonmergepatch: [null, '3.1.0?topic=functions-jsonmergepatch'],
  jsonmove: [null, '3.1.0?topic=functions-jsonmove'],
  jsonpatch: [null, '3.1.0?topic=functions-jsonpatch'],
  jsonremove: [null, '3.1.0?topic=functions-jsonremove'],
  jsonreplace: [null, '3.1.0?topic=functions-jsonreplace'],
  jsonsize: [null, '3.1.0?topic=functions-jsonsize'],
  jsontostring: [null, '3.1.0?topic=functions-jsontostring'],
  jsontype: [null, '3.1.0?topic=functions-jsontype'],
  metadataminorerrorcount: ['2.1.0?topic=variables-metadataminorerrorcount', '3.1.0?topic=variables-metadataminorerrorcount'],
  minorerrorlogmax: ['2.1.0?topic=variables-minorerrorlogmax', '3.1.0?topic=variables-minorerrorlogmax'],
  numericglobalvariable: ['2.1.0?topic=variables-numericglobalvariablevariablename', '3.1.0?topic=variables-numericglobalvariablevariablename'],
  nvalue: ['2.1.0?topic=variables-nvalue', '3.1.0?topic=variables-nvalue'],
  onminorerrordoitemskip: ['2.1.0?topic=variables-onminorerrordoitemskip', '3.1.0?topic=variables-onminorerrordoitemskip'],
  processexecutioninprogress: [null, '3.1.0?topic=functions-processexecutioninprogress'],
  processexitbybreak: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitbychorequit: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitbyquit: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitminorerror: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitnormal: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitoninit: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitseriouserror: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processexitwithmessage: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  processreturncode: ['2.1.0?topic=variables-processreturncode', '3.1.0?topic=variables-processreturncode'],
  prologminorerrorcount: ['2.1.0?topic=variables-prologminorerrorcount', '3.1.0?topic=variables-prologminorerrorcount'],
  refreshmdxhierarchy: ['2.1.0?topic=functions-refreshmdxhierarchy', null],
  removecamidassociation: ['2.1.0?topic=functions-removecamidassociation', null],
  removecamidassociationfromgroup: ['2.1.0?topic=functions-removecamidassociationfromgroup', null],
  returntablehandle: [null, '3.1.0?topic=functions-returntablehandle'],
  savedataall: ['2.1.0?topic=functions-savedataall', null],
  servershutdown: ['2.1.0?topic=functions-servershutdown', null],
  setchoreverbosemessages: ['2.1.0?topic=functions-setchoreverbosemessages', null],
  setodbcunicodeinterface: ['2.1.0?topic=functions-setodbcunicodeinterface', null],
  stringglobalvariable: ['2.1.0?topic=variables-stringglobalvariablevariablename', '3.1.0?topic=variables-stringglobalvariablevariablename'],
  stringtojson: [null, '3.1.0?topic=functions-stringtojson'],
  subsetformatstyleset: ['2.1.0?topic=functions-subsetformatstyleset', null],
  svalue: ['2.1.0?topic=variables-svalue', '3.1.0?topic=variables-svalue'],
  valueisstring: ['2.1.0?topic=variables-value-is-string', '3.1.0?topic=variables-value-is-string'],
  waitforalljobs: [null, '3.1.0?topic=functions-waitforalljobs'],
  waitforanyjobs: [null, '3.1.0?topic=functions-waitforanyjobs'],
  waitforinternaljobs: [null, '3.1.0?topic=functions-waitforinternaljobs'],
};
