import { describe, it, expect } from 'vitest';
import { mapAppType, parseAppEntries, appContentsPath } from '../tm1Rest/applicationsApi';

describe('mapAppType', () => {
  it('maps known odata types', () => {
    expect(mapAppType('#ibm.tm1.api.v1.Folder')).toBe('folder');
    expect(mapAppType('#ibm.tm1.api.v1.DocumentReference')).toBe('document');
    expect(mapAppType('#ibm.tm1.api.v1.Link')).toBe('link');
    expect(mapAppType('#ibm.tm1.api.v1.ViewReference')).toBe('viewRef');
    expect(mapAppType('#ibm.tm1.api.v1.ProcessReference')).toBe('processRef');
    expect(mapAppType('#ibm.tm1.api.v1.ChoreReference')).toBe('choreRef');
    expect(mapAppType('#ibm.tm1.api.v1.CubeReference')).toBe('cubeRef');
    expect(mapAppType('#ibm.tm1.api.v1.DimensionReference')).toBe('dimensionRef');
    expect(mapAppType('#ibm.tm1.api.v1.SubsetReference')).toBe('subsetRef');
    expect(mapAppType('#something.Else')).toBe('unknown');
  });
});

describe('appContentsPath', () => {
  it('builds root public path', () => {
    expect(appContentsPath([], 'Contents')).toBe("Contents('Applications')/Contents");
  });
  it('nests folders and switches leaf container', () => {
    expect(appContentsPath(['DemoApp'], 'PrivateContents'))
      .toBe("Contents('Applications')/Contents('DemoApp')/PrivateContents");
  });
  it('appends escaped key', () => {
    expect(appContentsPath(['A'], 'Contents', "x'y"))
      .toBe("Contents('Applications')/Contents('A')/Contents('x''y')");
  });
});

describe('parseAppEntries', () => {
  it('parses folder + document + link and carries isPrivate', () => {
    const body = JSON.stringify({ value: [
      { '@odata.type': '#ibm.tm1.api.v1.Folder', ID: 'DemoApp', Name: 'DemoApp' },
      { '@odata.type': '#ibm.tm1.api.v1.DocumentReference', ID: 'Portal.xlsx.blob', Name: 'Portal.xlsx' },
      { '@odata.type': '#ibm.tm1.api.v1.Link', ID: 'l.extr', Name: 'l', URL: 'https://example.com' },
    ]});
    const out = parseAppEntries({ body }, false);
    expect(out).toEqual([
      { id: 'DemoApp', name: 'DemoApp', type: 'folder', isPrivate: false },
      { id: 'Portal.xlsx.blob', name: 'Portal.xlsx', type: 'document', isPrivate: false },
      { id: 'l.extr', name: 'l', type: 'link', isPrivate: false, url: 'https://example.com' },
    ]);
  });
  it('marks private and tolerates empty', () => {
    expect(parseAppEntries({ body: JSON.stringify({ value: [] }) }, true)).toEqual([]);
    const out = parseAppEntries({ body: JSON.stringify({ value: [
      { '@odata.type': '#ibm.tm1.api.v1.Folder', ID: 'P', Name: 'P' },
    ]}) }, true);
    expect(out[0].isPrivate).toBe(true);
  });
});
