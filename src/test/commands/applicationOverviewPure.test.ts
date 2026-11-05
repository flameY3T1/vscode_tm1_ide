import { describe, it, expect } from 'vitest';
import JSZip = require('jszip');
import { scanFormulas, scanWorkbook, missingRefs, tm1NameKey, buildAppRows, buildAppKpis, DEFINED_NAMES } from '../../commands/applicationOverviewPure';
import { toTreeEntry } from '../../tm1Rest/applicationsApi';

describe('scanFormulas', () => {
  it('takes only complete string literals, split into server and name, with their sheets', () => {
    const at = (sheet: string, formula: string) => ({ sheet, formula });
    const refs = scanFormulas([
      at('Input', 'DBRW("Srv:Sales",$B$1,"Jan")'),
      at('Report', '_xll.DBRW("Srv:Sales",C2)'),   // same cube, other sheet, PAx prefix
      at('Input', 'DBRW($B$1,"x")'),                // cell reference: nothing to check
      at('Input', 'DBRW("Srv:"&B1,"x")'),           // concatenated: nothing to check
      at('Input', 'SUBNM("Srv:Month","","Jan")'),
      at('Report', 'TM1RPTVIEW("Srv:Sales:12345",0)'),
      at('Input', 'DBR("Srv:",A1)'),                // empty cube name
      at('Input', 'ELLEV("Region",A1)'),            // no server prefix
      at('Input', 'MYDBRW("Srv:Other",1)'),         // not a TM1 function
    ]);
    expect(refs).toEqual([
      { kind: 'dimension', server: 'Srv', name: 'Month', sheets: ['Input'] },
      { kind: 'dimension', server: '', name: 'Region', sheets: ['Input'] },
      { kind: 'cube', server: 'Srv', name: 'Sales', sheets: ['Input', 'Report'] },
    ]);
  });
});

describe('scanFormulas: object argument per function', () => {
  const scan = (formula: string) => scanFormulas([{ sheet: 'S', formula }]).map(({ kind, server, name }) => ({ kind, server, name }));
  it('DBRA/DBSA name a dimension, the write functions name the object after the value', () => {
    expect(scan('DBRA("Srv:Product","A","Caption")')).toEqual([{ kind: 'dimension', server: 'Srv', name: 'Product' }]);
    expect(scan('DBSA("x";"Srv:Product";"A";"Caption")')).toEqual([{ kind: 'dimension', server: 'Srv', name: 'Product' }]);
    expect(scan('DBSW(12,"Srv:Sales","A")')).toEqual([{ kind: 'cube', server: 'Srv', name: 'Sales' }]);
    expect(scan('DBSS("hello","Srv:Sales","A")')).toEqual([{ kind: 'cube', server: 'Srv', name: 'Sales' }]);
    expect(scan('DBS(SUM(A1,B1),"Srv:Sales","A")')).toEqual([{ kind: 'cube', server: 'Srv', name: 'Sales' }]);
    expect(scan('DBS(1,$B$1,"A")')).toEqual([]);
  });
});

describe('missingRefs', () => {
  const cubes = new Set(['sales'].map(tm1NameKey));
  const dims = new Set(['month'].map(tm1NameKey));
  it('checks own-server and unprefixed names, ignores foreign servers, ignores case and spaces', () => {
    const missing = missingRefs([
      { kind: 'cube', server: 'srv', name: 'S ales', sheets: [] },
      { kind: 'cube', server: 'Srv', name: 'Gone', sheets: [] },
      { kind: 'cube', server: 'Other', name: 'Gone', sheets: [] },
      { kind: 'dimension', server: '', name: 'Year', sheets: [] },
    ], 'Srv', cubes, dims);
    expect(missing.map(r => r.name)).toEqual(['Gone', 'Year']);
  });
});

describe('scanWorkbook', () => {
  it('names sheets via workbook.xml + rels, not by part number; non-zip is null', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<sheets><sheet name="Report &amp; Plan" sheetId="1" r:id="rId2"/><sheet name="Input" sheetId="2" r:id="rId1"/></sheets>'
      + '<definedNames><definedName name="x">DBRW(&quot;Srv:Costs&quot;,A1)</definedName></definedNames>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', '<c><f>DBRW(&quot;Srv:Sales&quot;,A1)</f></c>');
    zip.file('xl/worksheets/sheet2.xml', '<c><f t="shared" si="0">DBRW(&quot;Srv:Sales&quot;,A1)</f></c>');
    const refs = await scanWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(refs?.map(r => [r.name, r.sheets])).toEqual([
      ['Costs', [DEFINED_NAMES]],
      ['Sales', ['Report & Plan', 'Input']],
    ]);
    expect(await scanWorkbook(Buffer.from('not a zip'))).toBeNull();
  });
});

describe('toTreeEntry', () => {
  it('resolves view references and flags a missing target', () => {
    const ok = toTreeEntry({ '@odata.type': '#ibm.tm1.api.v1.ViewReference', ID: 'v.view', Name: 'v',
      View: { Name: 'v', Cube: { Name: 'Sales' } } }, ['A'], false);
    expect(ok.target).toEqual({ cubeName: 'Sales', viewName: 'v' });
    expect(ok.broken).toBe(false);
    const gone = toTreeEntry({ '@odata.type': '#ibm.tm1.api.v1.CubeReference', ID: 'c.cube', Name: 'c' }, [], false);
    expect(gone.broken).toBe(true);
    const doc = toTreeEntry({ '@odata.type': '#ibm.tm1.api.v1.DocumentReference', ID: 'b.xlsx.blob', Name: 'b.xlsx',
      Document: { Size: 10, LastUpdated: '2021-01-02T00:00:00Z' } }, [], true);
    const [row] = buildAppRows([doc], s => s, '—', n => `${n} B`);
    expect(row.cells).toMatchObject({ size: '10 B', updated: '2021-01-02', private: true, cubes: null, type: 'Excel' });
  });
});

describe('buildAppKpis', () => {
  it('counts folders and one tile per kind present, largest first', () => {
    const e = (type: string, id: string) => ({ type, id, name: id, isPrivate: false, folderPath: [] }) as never;
    const kpis = buildAppKpis([e('folder', 'A'), e('folder', 'B'), e('document', 'a.xlsx.blob'), e('document', 'b.xlsm.blob'),
      e('document', 'c.xlsx.blob'), e('viewRef', 'v.view')], Date.parse('2026-09-27'), s => s, n => `${n} B`);
    expect(kpis.slice(0, 4).map(k => [k.label, k.value])).toEqual([
      ['Folders', '2'], ['Excel', '2'], ['Excel (macros)', '1'], ['View reference', '1'],
    ]);
  });
});
