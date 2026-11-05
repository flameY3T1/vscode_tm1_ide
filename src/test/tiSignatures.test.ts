import { KNOWN_SIGNATURES, type TiKnownSignature } from '../tiLogicVisualizer/tiSignatures';
import { IBM_DOC_NONE, IBM_DOC_PAGES } from '../tiLogicVisualizer/ibmDocPages';

/**
 * All function names present in the SIGNATURES map of tm1SignatureHelpProvider.ts.
 * Used to verify that tiSignatures.ts covers every known TI function.
 */
const PROVIDER_FUNCTION_NAMES = [
  // Cell functions
  'CellGetN', 'CellGetS', 'CellPutN', 'CellPutS',
  // String functions
  'STR', 'SUBST', 'SCAN', 'TRIM', 'UPPER', 'LOWER',
  'LONG', 'CHAR', 'CODE', 'FILL', 'CAPIT', 'DELET', 'INSRT', 'NUMBR',
  'Expand', 'NumberToString', 'NumberToStringEx', 'StringToNumber',
  // Math functions
  // POWER + LOG10 removed — live-verified they don't exist in TM1 11.8 (compile-abort).
  'ABS', 'INT', 'ROUND', 'MOD', 'MAX', 'MIN', 'SQRT', 'SIN', 'LOG', 'EXP', 'RAND',
  // Date/time functions
  'TODAY', 'NOW', 'DATE', 'DAYNO', 'TIMST', 'YEAR', 'MONTH', 'DAY', 'ParseDate',
  // Dimension/Element functions
  'DIMSIZ', 'DIMNM', 'DIMIX', 'DTYPE', 'DNLEV', 'DNEXT',
  'ELPAR', 'ELPARN', 'ELLEV', 'ELCOMP', 'ELCOMPN', 'ELWEIGHT', 'ELISANC',
  // Attribute functions
  'ATTRS', 'ATTRN',
  // Process control
  'ExecuteProcess', 'LogOutput', 'ASCIIOutput', 'TextOutput',
  'SaveDataAll', 'GetProcessName',
  // Validation
  'ISUND',
  // Create/Insert
  'DimensionCreate', 'SubsetCreate',
  'CubeCreate', 'ViewCreate', 'ViewZeroOut', 'StringGlobalVariable', 'NumericGlobalVariable', 'SecurityRefresh',
  // Hierarchy Attribute (Task 1a)
  'HierarchyAttrN', 'HierarchyAttrS', 'HierarchyAttrNL', 'HierarchyAttrSL',
  'HierarchyAttrPutN', 'HierarchyAttrPutS',
  // Hierarchy Core (Task 1b)
  'HierarchyDestroy', 'HierarchyDeleteAllElements', 'HierarchyDeleteElements',
  'HierarchyContainsAllLeaves', 'HierarchyHasOrphanedLeaves',
  'HierarchyTimeLastUpdated', 'HierarchyUpdateDirect', 'HierarchySortOrder',
  'HierarchyTopElementInsert', 'HierarchyTopElementInsertDirect',
  // Hierarchy Element (Task 1c)
  'HierarchyElementExists', 'HierarchyElementDeleteDirect', 'HierarchyElementInsertDirect',
  'HierarchyElementPrincipalName',
  'HierarchyElementComponentAddDirect', 'HierarchyElementComponentDelete',
  'HierarchyElementComponentDeleteDirect',
  'HierarchyElementSecurityGet', 'HierarchyElementSecurityPut',
  // Hierarchy Subset (Task 1d)
  'HierarchySubsetCreate', 'HierarchySubsetDestroy', 'HierarchySubsetExists',
  'HierarchySubsetDeleteAllElements', 'HierarchySubsetElementInsert',
  'HierarchySubsetElementDelete', 'HierarchySubsetElementExists',
  'HierarchySubsetElementGetIndex', 'HierarchySubsetGetElementName',
  'HierarchySubsetGetSize', 'HierarchySubsetIsAllSet',
  'HierarchySubsetMDXGet', 'HierarchySubsetMDXSet',
  'HierarchySubsetAliasGet', 'HierarchySubsetAliasSet',
  'HierarchySubsetAttrN', 'HierarchySubsetAttrS', 'HierarchySubsetAttrNL', 'HierarchySubsetAttrSL',
  'HierarchySubsetAttrPutN', 'HierarchySubsetAttrPutS',
  'HierarchySubsetAttrInsert', 'HierarchySubsetAttrDelete',
  // ODBC (Task 2) — ODBCInsert/Update/Delete/Value/ValueN/ValueS/InsertOpen/InsertClose
  // removed: live-verified they compile on neither 11.8 nor v12, at any arity from 0 to 4,
  // as a statement and assigned. Same class as the POWER/LOG10 removal above.
  // The real ODBC functions (ODBCOpen/Close/Output/OpenEx) live in 28-system-io-functions.
  // Cube-Attribute (Task 3a)
  'CubeAttrN', 'CubeAttrS', 'CubeAttrNL', 'CubeAttrSL',
  'CubeAttrPutN', 'CubeAttrPutS', 'CubeAttrInsert', 'CubeAttrDelete',
  // Dimension-Attribute (Task 3b)
  'DimensionAttrN', 'DimensionAttrS', 'DimensionAttrNL', 'DimensionAttrSL',
  'DimensionAttrPutN', 'DimensionAttrPutS', 'DimensionAttrInsert', 'DimensionAttrDelete',
  // Chore-Attribute (Task 3c)
  'ChoreAttrN', 'ChoreAttrS', 'ChoreAttrNL', 'ChoreAttrSL',
  'ChoreAttrPutN', 'ChoreAttrPutS', 'ChoreAttrInsert', 'ChoreAttrDelete',
  // Process-Attribute (Legacy-Aliase, real bedrock usage)
  'ProcessAttrPutN', 'ProcessAttrPutS',
  // View-Attribute (Task 3d)
  'ViewAttrN', 'ViewAttrS', 'ViewAttrNL', 'ViewAttrSL',
  'ViewAttrPutN', 'ViewAttrPutS', 'ViewAttrInsert', 'ViewAttrDelete',
  // Subset-Attribute (Task 3e)
  'SubsetAttrN', 'SubsetAttrS', 'SubsetAttrNL', 'SubsetAttrSL',
  'SubsetAttrPutN', 'SubsetAttrPutS', 'SubsetAttrInsert', 'SubsetAttrDelete',
  // Legacy / Element-Attr-Extensions (Task 3f)
  'AttrDelete', 'AttrInsert', 'AttrNL', 'AttrSL',
  'ElementAttrNL', 'ElementAttrSL', 'ElementAttrPutN', 'ElementAttrPutS',
  // Process-Control (Task 4)
  'ItemReject', 'ItemSkip',
  'ProcessBreak', 'ProcessQuit', 'ProcessError',
  'ForceSkipCheck',
  'DataMinorErrorCount',
  // Datasource Getter/Setter (Task 5)
  'DatasourceASCIIDecimalSeparator', 'DatasourceASCIIDelimiter',
  'DatasourceASCIIHeaderRecords', 'DatasourceASCIIQuoteCharacter',
  'DatasourceASCIIThousandSeparator',
  'DatasourceCubeview', 'DatasourceDimensionSubset',
  'DatasourceNameForClient', 'DatasourceNameForServer',
  'DatasourceODBOCatalog', 'DatasourceODBOConnectionString',
  'DatasourceODBOCubeName', 'DatasourceODBOHierarchyName',
  'DatasourceODBOLocation', 'DatasourceODBOProvider',
  'DatasourceODBOSAPClientID', 'DatasourceODBOSAPClientLanguage',
  'DatasourcePassword', 'DatasourceQuery',
  'DatasourceSAPUsingRoleAuths', 'DatasourceSAPUsingTexts',
  'DatasourceType', 'DatasourceUsername',
  // Task 6a CubeDR
  // Task 6b Cube-Misc
  'AddCubeDependency', 'CubeDimensionCountGet', 'CubeProcessFeeders',
  'CubeRuleAppend', 'CubeRuleDestroy', 'CubeTimeLastUpdated',
  'CellSecurityCubeCreate', 'CellSecurityCubeDestroy',
  // Task 6c Cell-Misc
  'CellIncrementN', 'CellPutProportionalSpread',
  // Task 6d Chore-Control
  'ChoreError', 'ChoreQuit', 'ChoreRollback',
  // Task 6e Dimension-Direct + Misc
  'DimensionDeleteElements', 'DimensionElementComponentAddDirect',
  'DimensionElementComponentDeleteDirect', 'DimensionElementDeleteDirect',
  'DimensionElementInsertDirect', 'DimensionElementPrincipalName',
  'DimensionHierarchyCreate', 'DimensionTimeLastUpdated',
  'DimensionTopElementInsert', 'DimensionTopElementInsertDirect',
  'DimensionUpdateDirect', 'DeleteAllPersistentFeeders',
  // Task 6f HTTP
  'ExecuteHttpRequest', 'HttpResponseGetBody',
  'HttpResponseGetHeader', 'HttpResponseGetStatusCode',
  // Task 6g MDX / MetaData / OLAP
  
  
  // Task 6h Token / Text
  // Task 6i Transaction
  // Task 6j View-Misc + Subset-Legacy
  'SubsetAliasGet', 'SubsetAliasSet', 'SubsetDeleteAllElements', 'SubsetDestroy',
  'SubsetElementExists', 'SubsetElementGetIndex', 'SubsetElementInsert',
  'SubsetIsAllSet', 'SubsetMDXGet', 'SubsetMDXSet',
  'ViewDestroy',
  'ViewMDXGet', 'ViewMDXSet',
  // Task 6k Sonstige
  'AssignClientToGroup', 'AsciiOutputOpen', 'CancelJobs',
  'DisableMTQViewConstruct', 'EnableMTQViewConstruct',
  'FormatDate', 'GetJobStatus', 'GetProcessErrorFilename',
  'GetUseActiveSandboxProperty', 'LevelCount', 'Sleep',
];

/**
 * Names that were in the catalog but are not TI functions — no IBM page in 2.0.0, 2.1.0 or
 * 3.1.0 (probed 2026-10-07), confirmed by a TM1 developer or without any TM1 hit in a web search. They stay out, so the linter
 * flags them as unknown instead of accepting them.
 */
const NOT_TI_FUNCTIONS = [
  'CellExists',
  'CellIsUndefined',
  'CellIsRule',
  'CellIncrement',
  'LTRIM',
  'RTRIM',
  'AttributePut',
  'AttributeGet',
  'AttributeCreate',
  'AttributeDelete',
  'ServerName',
  'ElementInsert',
  'ElementDelete',
  'ElementExists',
  'CubeDelete',
  'CubeGetN',
  'CubeGetS',
  'CubePutN',
  'CubePutS',
  'RuleDestroy',
  'DimensionElementMove',
  'DimensionElementCount',
  'ELISSTR',
  'ViewDelete',
  'ViewZero',
  'ViewGetN',
  'ViewGetS',
  'ViewPutN',
  'ViewPutS',
  'AddClientToGroup',
  'GetLastError',
  'GetLastErrorMessage',
  'SetOutputSuppression',
  'SetStatisticalOutput',
  'ViewColumnDimensionGet',
  'ViewColumnDimensionSetGet',
  'ViewMDXActivate',
  'ViewMDXDeActivate',
  'ViewRowDimensionGet',
  'ViewRowDimensionSetGet',
  'ViewStructCompact',
  'ViewStructUpdate',
  'ViewSubsetGet',
  'ViewZeroSuppressionGet',
  'ViewZeroSuppressionSet',
  'HierarchyElementCount',
  'HierarchyName',
  'ViewExtractSkipConsolidatedValuesSet',
  'EpilogMinorErrorCount',
  'ProcessContinue',
  'ProcessReturn',
  'ProcessSeparator',
  'RollbackUpdates',
  'SecurityOverride',
  'SetDataErrorHandling',
  'SetEpilogErrorHandling',
  'SetPrologErrorHandling',
  'TM1ProcessError',
  'CubeDRAcquire',
  'CubeDRGet',
  'CubeDRGetConflicts',
  'CubeDRRelease',
  'CubeDRReleaseAll',
  'TranDelete',
  'TranGetStatus',
  'TranLogicalOpen',
  'TranOpen',
  'TranSave',
  'TransactionLogNumRecords',
  'TransactionResult',
  'SYS',
  'TM1Message',
  'TMPNameGet',
  'TMPNameGetEx',
  'TRACE',
  'VALUE',
  'VALUEPMT',
  'SubsetToSet',
  'MDXSetExpression',
  'MDXSetExpressionLogical',
  'MDXSetExpressionNonCalculated',
  'MetaDataAllRollups',
  'MetaDataRollups',
  'MetaDataRollupsAll',
  'OLAPCubeName',
  'OLAPDimensionNames',
  'OLAPDimensionProperty',
  'OLAPElementName',
  'OLAPElementNames',
  'OLAPMemberProperty',
  'OLAPTuplesToODBCInsert',
  'OLAPTuplesToODBCUpdate',
  'TokenGet',
  'TokenNum',
  'TokenNumArgs',
  'TokenStr',
  'TokenStrType',
  'TokenType',
];

describe('tiSignatures — KNOWN_SIGNATURES completeness', () => {
  it.each(NOT_TI_FUNCTIONS)('%s is not a TI function and stays out of KNOWN_SIGNATURES', (name) => {
    expect(KNOWN_SIGNATURES.has(name.toLowerCase())).toBe(false);
  });

  it.each(PROVIDER_FUNCTION_NAMES)(
    '%s from tm1SignatureHelpProvider is present in KNOWN_SIGNATURES',
    (name) => {
      const sig = KNOWN_SIGNATURES.get(name.toLowerCase());
      expect(sig).toBeDefined();
      expect(sig!.name).toBe(name);
    },
  );

  it('KNOWN_SIGNATURES covers at least the provider SIGNATURES', () => {
    expect(KNOWN_SIGNATURES.size).toBeGreaterThanOrEqual(PROVIDER_FUNCTION_NAMES.length);
  });
});

describe('tiSignatures — return types', () => {
  const returnTypeCases: [string, TiKnownSignature['returnType']][] = [
    // numeric-returning functions
    ['CellGetN', 'numeric'],
    ['ATTRN', 'numeric'],
    ['DIMIX', 'numeric'],
    ['DIMSIZ', 'numeric'],
    ['LONG', 'numeric'],
    ['NUMBR', 'numeric'],
    ['StringToNumber', 'numeric'],
    ['ABS', 'numeric'],
    ['SCAN', 'numeric'],
    ['RAND', 'numeric'],
    // string-returning functions
    ['CellGetS', 'string'],
    ['ATTRS', 'string'],
    ['STR', 'string'],
    ['SUBST', 'string'],
    ['TRIM', 'string'],
    ['UPPER', 'string'],
    ['LOWER', 'string'],
    ['DIMNM', 'string'],
    ['NumberToString', 'string'],
    ['Expand', 'string'],
    ['GetProcessName', 'string'],
    // void-returning functions
    ['CellPutN', 'void'],
    ['CellPutS', 'void'],
    ['LogOutput', 'void'],
    ['ExecuteProcess', 'void'],
    ['DimensionCreate', 'void'],
    ['SaveDataAll', 'void'],
    ['SecurityRefresh', 'void'],
  ];

  it.each(returnTypeCases)('%s → %s', (name, expectedType) => {
    const sig = KNOWN_SIGNATURES.get(name.toLowerCase())!;
    expect(sig.returnType).toBe(expectedType);
  });
});

describe('tiSignatures — param counts and types', () => {
  it('CellGetN is variadic with minParams=3', () => {
    const sig = KNOWN_SIGNATURES.get('cellgetn')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(Infinity);
    expect(sig.params[0]).toMatchObject({ name: 'CubeName', type: 'string' });
  });

  it('CellPutN has minParams=4 with numeric Value as first param', () => {
    const sig = KNOWN_SIGNATURES.get('cellputn')!;
    expect(sig.minParams).toBe(4);
    expect(sig.maxParams).toBe(Infinity);
    expect(sig.params[0]).toMatchObject({ name: 'Value', type: 'numeric' });
    expect(sig.params[1]).toMatchObject({ name: 'CubeName', type: 'string' });
  });

  it('STR has exactly 3 params, all numeric', () => {
    const sig = KNOWN_SIGNATURES.get('str')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(3);
    expect(sig.params).toHaveLength(3);
    sig.params.forEach((p) => expect(p.type).toBe('numeric'));
  });

  it('TRIM has exactly 1 string param', () => {
    const sig = KNOWN_SIGNATURES.get('trim')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(1);
    expect(sig.params).toMatchObject([{ name: 'String', type: 'string' }]);
  });

  it('RAND has 0 params', () => {
    const sig = KNOWN_SIGNATURES.get('rand')!;
    expect(sig.minParams).toBe(0);
    expect(sig.maxParams).toBe(0);
    expect(sig.params).toEqual([]);
  });

  it('LogOutput has 2 params: string Severity, string Message', () => {
    const sig = KNOWN_SIGNATURES.get('logoutput')!;
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(2);
    expect(sig.params[0]).toMatchObject({ name: 'Severity', type: 'string' });
    expect(sig.params[1]).toMatchObject({ name: 'Message', type: 'string' });
  });

  it('all keys in KNOWN_SIGNATURES are lowercase', () => {
    for (const key of KNOWN_SIGNATURES.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('SubsetCreate accepts optional AsTemporary (minParams=2, maxParams=3)', () => {
    const sig = KNOWN_SIGNATURES.get('subsetcreate')!;
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(3);
    expect(sig.params[2]).toMatchObject({ name: 'AsTemporary', type: 'numeric' });
  });

  it('ViewCreate accepts optional AsTemporary (minParams=2, maxParams=3)', () => {
    const sig = KNOWN_SIGNATURES.get('viewcreate')!;
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(3);
    expect(sig.params[2]).toMatchObject({ name: 'AsTemporary', type: 'numeric' });
  });

  it('SubsetCreateByMDX accepts 2-4 args (overloaded; positional types relaxed to any)', () => {
    const sig = KNOWN_SIGNATURES.get('subsetcreatebymdx')!;
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(4);
    expect(sig.params[0]).toMatchObject({ name: 'SubsetName', type: 'string' });
    // Middle/last positions ambiguous due to legacy/new overloads → type 'any'
    expect(sig.params[1].type).toBe('any');
    expect(sig.params[2].type).toBe('any');
    expect(sig.params[3].type).toBe('any');
  });

  it('ViewCreateByMDX accepts optional AsTemporary (minParams=3, maxParams=4)', () => {
    const sig = KNOWN_SIGNATURES.get('viewcreatebymdx')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(4);
    expect(sig.params[3]).toMatchObject({ name: 'AsTemporary', type: 'numeric' });
  });

  it('ViewZeroOut has 2 string params, returns void', () => {
    const sig = KNOWN_SIGNATURES.get('viewzeroout')!;
    expect(sig.name).toBe('ViewZeroOut');
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(2);
    expect(sig.params).toMatchObject([
      { name: 'CubeName', type: 'string' },
      { name: 'ViewName', type: 'string' },
    ]);
    expect(sig.returnType).toBe('void');
  });

  it('ParseDate has DateString required + optional Pattern/Index, returns numeric', () => {
    const sig = KNOWN_SIGNATURES.get('parsedate')!;
    expect(sig.name).toBe('ParseDate');
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(3);
    expect(sig.params).toMatchObject([
      { name: 'DateString', type: 'string' },
      { name: 'Pattern', type: 'string' },
      { name: 'Index', type: 'numeric' },
    ]);
    expect(sig.returnType).toBe('numeric');
  });

  it('NumberToStringEx has 4 params (numeric, string, string, string), returns string', () => {
    const sig = KNOWN_SIGNATURES.get('numbertostringex')!;
    expect(sig.name).toBe('NumberToStringEx');
    expect(sig.minParams).toBe(4);
    expect(sig.maxParams).toBe(4);
    expect(sig.params).toMatchObject([
      { name: 'Number', type: 'numeric' },
      { name: 'FormatString', type: 'string' },
      { name: 'DecimalSeparator', type: 'string' },
      { name: 'ThousandsSeparator', type: 'string' },
    ]);
    expect(sig.returnType).toBe('string');
  });

  // ── Prio-A gap-fill 2026-05-13 ──────────────────────────────────────────────
  it('HierarchyElementInsert: Weight is optional → minParams=5, maxParams=6', () => {
    const sig = KNOWN_SIGNATURES.get('hierarchyelementinsert')!;
    expect(sig.minParams).toBe(5);
    expect(sig.maxParams).toBe(6);
    expect(sig.params[5]).toMatchObject({ name: 'Weight', type: 'numeric' });
  });

  it('AsciiOutputOpen accepts optional OpeningMode → minParams=1, maxParams=2', () => {
    const sig = KNOWN_SIGNATURES.get('asciioutputopen')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(2);
    expect(sig.params[1]).toMatchObject({ name: 'OpeningMode', type: 'numeric' });
  });

  it('FILE_OPEN_APPEND / FILE_OPEN_SHARED are zero-arg numeric helpers for AsciiOutputOpen', () => {
    for (const key of ['file_open_append', 'file_open_shared']) {
      const sig = KNOWN_SIGNATURES.get(key)!;
      expect(sig).toBeDefined();
      expect(sig.minParams).toBe(0);
      expect(sig.maxParams).toBe(0);
      expect(sig.returnType).toBe('numeric');
    }
  });

  it('client/group management functions are NOT v12-deprecated (they are not on the TM1 Database 12 deprecated-features list); only AssignClientPassword is', () => {
    // Per IBM 3.1.0 docs, AddClient/AddGroup/DeleteClient/… are documented without
    // a v12 restriction; AssignClientPassword is the one flagged as unsupported.
    expect(KNOWN_SIGNATURES.get('assignclientpassword')!.deprecatedInV12).toBe(true);
    for (const key of [
      'addclient', 'addgroup',
      'assignclienttogroup', 'deleteclient', 'deletegroup', 'removeclientfromgroup',
    ]) {
      const sig = KNOWN_SIGNATURES.get(key)!;
      expect(sig, key).toBeDefined();
      expect(sig.deprecatedInV12 ?? false, key).toBe(false);
    }
  });

  it('HierarchySubsetElementDelete param 4 is numeric Index (not ElementName)', () => {
    const sig = KNOWN_SIGNATURES.get('hierarchysubsetelementdelete')!;
    expect(sig.minParams).toBe(4);
    expect(sig.maxParams).toBe(4);
    expect(sig.params[3]).toMatchObject({ name: 'Index', type: 'numeric' });
  });

  it('AttrPutS/N accept optional LocaleCode + PassSecurity (overloaded) → min=4, max=6', () => {
    // Real bedrock-Aufrufe (}bedrock.dim.clone.pro):
    //   AttrPutS(val, dim, elem, attr)              — 4-arg
    //   AttrPutS(val, dim, elem, attr, 1)           — 5-arg (PassSec)
    //   AttrPutS(val, dim, elem, attr, 'en')        — 5-arg (LocaleCode)
    //   AttrPutS(val, dim, elem, attr, 'en', 1)     — 6-arg (Locale + PassSec)
    // Param[4]+[5] are type='any' so that both arg types are accepted.
    for (const key of ['attrputs', 'attrputn']) {
      const sig = KNOWN_SIGNATURES.get(key)!;
      expect(sig.minParams).toBe(4);
      expect(sig.maxParams).toBe(6);
      expect(sig.params[4].type).toBe('any');
      expect(sig.params[5].type).toBe('any');
    }
  });

  it('SetOutputCharacterSet has 2 string params (FileName, CharacterSet)', () => {
    const sig = KNOWN_SIGNATURES.get('setoutputcharacterset')!;
    expect(sig.minParams).toBe(2);
    expect(sig.maxParams).toBe(2);
    expect(sig.params[0].type).toBe('string');
    expect(sig.params[1].type).toBe('string');
    expect(sig.returnType).toBe('void');
  });

  it('SetInputCharacterSet accepts 1 or 2 args (1-arg = current datasource)', () => {
    // Real bedrock-Aufruf: SetInputCharacterSet(pCharacterSet); — 1 Arg.
    const sig = KNOWN_SIGNATURES.get('setinputcharacterset')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(2);
    expect(sig.params.every(p => p.type === 'string')).toBe(true);
  });

  it('SetUseActiveSandboxProperty has 1 numeric Flag param', () => {
    const sig = KNOWN_SIGNATURES.get('setuseactivesandboxproperty')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(1);
    expect(sig.params[0]).toMatchObject({ name: 'Flag', type: 'numeric' });
  });

  it('ServerActiveSandboxSet has 1 string SandboxName param', () => {
    const sig = KNOWN_SIGNATURES.get('serveractivesandboxset')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(1);
    expect(sig.params[0]).toMatchObject({ name: 'SandboxName', type: 'string' });
  });

  it('ElementSecurityPut (legacy) has 4 string params (Level is string code, not numeric)', () => {
    // IBM Docs (PA 2.0.0): Level is 'None'|'Read'|'Write'|'Reserve'|'Lock'|'Admin'.
    const sig = KNOWN_SIGNATURES.get('elementsecurityput')!;
    expect(sig.minParams).toBe(4);
    expect(sig.maxParams).toBe(4);
    expect(sig.params[0]).toMatchObject({ name: 'Level', type: 'string' });
    expect(sig.params.every(p => p.type === 'string')).toBe(true);
  });

  it('StringToNumberEx has 3 string params + numeric return', () => {
    const sig = KNOWN_SIGNATURES.get('stringtonumberex')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(3);
    expect(sig.params[0]).toMatchObject({ name: 'String', type: 'string' });
    expect(sig.params[1]).toMatchObject({ name: 'DecimalSeparator', type: 'string' });
    expect(sig.params[2]).toMatchObject({ name: 'ThousandSeparator', type: 'string' });
    expect(sig.returnType).toBe('numeric');
  });

  it('ServerSandboxExists accepts 1 or 2 string params, returns numeric', () => {
    const sig = KNOWN_SIGNATURES.get('serversandboxexists')!;
    expect(sig.minParams).toBe(1);
    expect(sig.maxParams).toBe(2);
    expect(sig.params[0]).toMatchObject({ name: 'SandboxName', type: 'string' });
    expect(sig.params[1]).toMatchObject({ name: 'UserName', type: 'string' });
    expect(sig.returnType).toBe('numeric');
  });

  it('ViewExtractSkipConsolidatedStringsSet has 3 params (cube, view, numeric Skip)', () => {
    const sig = KNOWN_SIGNATURES.get('viewextractskipconsolidatedstringsset')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(3);
    expect(sig.params[2]).toMatchObject({ name: 'Skip', type: 'numeric' });
  });

  it('PublishView has 4 params (cube, view, 2× numeric flags)', () => {
    const sig = KNOWN_SIGNATURES.get('publishview')!;
    expect(sig.minParams).toBe(4);
    expect(sig.maxParams).toBe(4);
    expect(sig.params[0].type).toBe('string');
    expect(sig.params[2].type).toBe('numeric');
    expect(sig.params[3].type).toBe('numeric');
  });

  it('PublishSubset has 3 params (dim, sub, numeric OverwriteExisting)', () => {
    const sig = KNOWN_SIGNATURES.get('publishsubset')!;
    expect(sig.minParams).toBe(3);
    expect(sig.maxParams).toBe(3);
    expect(sig.params[2]).toMatchObject({ name: 'OverwriteExisting', type: 'numeric' });
  });

  it('ProcessAttrPutS/N accept optional LocaleCode → minParams=3, maxParams=4', () => {
    for (const key of ['processattrputs', 'processattrputn']) {
      const sig = KNOWN_SIGNATURES.get(key)!;
      expect(sig.minParams).toBe(3);
      expect(sig.maxParams).toBe(4);
      expect(sig.params[1]).toMatchObject({ name: 'ProcessName', type: 'string' });
      expect(sig.params[2]).toMatchObject({ name: 'AttributeName', type: 'string' });
      expect(sig.params[3]).toMatchObject({ name: 'LocaleCode', type: 'string' });
    }
    expect(KNOWN_SIGNATURES.get('processattrputn')!.params[0].type).toBe('numeric');
    expect(KNOWN_SIGNATURES.get('processattrputs')!.params[0].type).toBe('string');
  });

  it('Break is registered as 0-arg void control-flow keyword (autocomplete, signature help)', () => {
    const sig = KNOWN_SIGNATURES.get('break')!;
    expect(sig).toBeDefined();
    expect(sig.name).toBe('Break');
    expect(sig.minParams).toBe(0);
    expect(sig.maxParams).toBe(0);
    expect(sig.returnType).toBe('void');
    expect(sig.params).toEqual([]);
  });
});

/** The table in ibmDocPages.ts is keyed like the URL: lowercase, no `_`. */
const docSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('tiSignatures — description + docUrl wiring', () => {
  // The base file has been ENGLISH since 2026-08-07; German lives in
  // `media/tiSignatureDocs.de.json` and is only loaded when the display
  // language is German (`tiSignaturesNodeBoot` / `sigsAsset`). The test loads
  // the base.
  it('CellGetN has its English description from signatureDocs', () => {
    const sig = KNOWN_SIGNATURES.get('cellgetn')!;
    expect(sig.description).toBe('Reads a numeric cell value from a cube.');
  });

  it('CellGetN params have doc strings', () => {
    const sig = KNOWN_SIGNATURES.get('cellgetn')!;
    expect(sig.params[0].doc).toBe('Name of the cube');
    expect(sig.params[1].doc).toBe('Element of the first dimension');
  });

  it('Every KNOWN_SIGNATURES entry has a docUrl unless IBM has no page for it', () => {
    for (const sig of KNOWN_SIGNATURES.values()) {
      if (IBM_DOC_NONE.has(docSlug(sig.name))) { expect(sig.docUrl).toBeUndefined(); continue; }
      expect(sig.docUrl).toMatch(/^https:\/\/www\.ibm\.com\/docs\//);
      expect(sig.docUrlV12).toMatch(/^https:\/\/www\.ibm\.com\/docs\//);
    }
  });

  it('the measured doc table names only known signatures', () => {
    const slugs = new Set([...KNOWN_SIGNATURES.values()].map(sig => docSlug(sig.name)));
    for (const key of [...IBM_DOC_NONE, ...Object.keys(IBM_DOC_PAGES)]) {
      expect(slugs.has(key), key).toBe(true);
    }
  });

  it('docUrl is built from lowercased function name (no special chars)', () => {
    const sig = KNOWN_SIGNATURES.get('numbertostringex')!;
    expect(sig.docUrl).toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-numbertostringex');
    expect(sig.docUrlV12).toBe('https://www.ibm.com/docs/en/planning-analytics/3.1.0?topic=functions-numbertostringex');
  });

  it('Functions without explicit description still get docUrl', () => {
    // Pick a function not in the 88 migrated docs (e.g. AddClient or RandomNumber-style)
    // Walk and find any sig without description but with docUrl.
    const noDescButHasUrl = [...KNOWN_SIGNATURES.values()].find(s => !s.description && s.docUrl);
    expect(noDescButHasUrl).toBeDefined();
  });
});
